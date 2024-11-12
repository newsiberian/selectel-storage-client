import got from 'got';
import { URLSearchParams } from 'url';

import type { Response } from 'got';
import * as fs from 'fs';
import * as strm from 'stream';

export type ContainerType = 'public' | 'private' | 'gallery';
type KnownPools = 'ru-1' | 'ru-2' | 'ru-3' | 'ru-7' | 'ru-8' | 'ru-9' | 'gis-1';
type Pool = KnownPools | Omit<KnownPools, string>;

export interface FileObject {
  bytes: number;
  content_type: string;
  hash: string;
  last_modified: string;
  name: string;
}

interface RequiredParams {
  container: string;
}

export interface Options {
  accountId: string;
  username: string;
  password: string;
  token?: string;
  projectId: string;
  projectName: string;
  /**
   * Servers location pool
   * @default ru-1
   * @see https://docs.selectel.ru/control-panel-actions/infrastructure/#selectel-infrastructure
   */
  pool?: Pool;
}

export interface CreateContainerParams extends RequiredParams {
  type?: ContainerType;
  metadata?: string;
}

export interface GetFilesParams extends RequiredParams {
  limit?: number;
  marker?: string;
  prefix?: string;
  delimiter?: string;
  format?: 'json' | 'xml';
}

export interface UploadFileParams extends RequiredParams {
  /**
   * File's buffer or local path
   */
  file: Buffer | strm.Stream | string;
  /**
   * In case when archive are passed, filename can be omitted.
   * In that case all archived files will be extracted within
   * container root, or it could be used as a folder name
   */
  fileName?: string;
  deleteAt?: number;
  lifetime?: number;
  etag?: string;
  metadata?: string;
  archive?: 'tar' | 'tar.gz' | 'gzip';
}

export interface DeleteFilesParams extends RequiredParams {
  /**
   * Files names
   */
  files: string[];
}

export interface DeleteFileParams extends RequiredParams {
  file: string;
}

interface Tenant {
  id: string;
  name: string;
}

interface User extends Tenant {
  roles: string[];
}

interface Token {
  id: string;
  expires: string;
  tenant: Tenant;
}

interface Access {
  token: Token;
  user: User;
}

interface AuthorizeJsonResponse {
  access: Access;
}

export interface AuthorizeReturn {
  expire?: string | number;
  token?: string;
}

export interface GetContainersData {
  name: string;
  count: number;
  bytes: number;
  type: ContainerType;
  /**
   * Container last modification date
   */
  last_modified: string;
}

export interface DeleteFilesReturn {
  'Number Not Found': number;
  'Response Status': string;
  'Response Body': string;
  Errors?: string[];
  'Number Deleted': number;
}

const buildApiUrl = (pool: Pool) => `https://swift.${pool}.storage.selcloud.ru`;

// https://developers.selectel.ru/docs/control-panel/urls/#%D1%81%D0%B0%D0%BD%D0%BA%D1%82-%D0%BF%D0%B5%D1%82%D0%B5%D1%80%D0%B1%D1%83%D1%80%D0%B3
const authorizationUrl =
  'https://cloud.api.selcloud.ru/identity/v3/auth/tokens';

export class SelectelStorageClient {
  /**
   * username is a public since it is required from outside when we want to cache
   * token, and we have several Selectel users in our app
   */
  public readonly username: string;
  private readonly accountId: string;
  private readonly password: string;
  private readonly storageUrl: string;
  private readonly projectId: string;
  private readonly projectName: string;
  /**
   * Authorization token
   */
  private token?: string;
  private expireAuthToken?: number;

  constructor(options: Options) {
    this.username = options.username;
    this.password = options.password;
    this.accountId = options.accountId;
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    /**
     * rename to storageApiUrl
     */
    this.storageUrl = `${buildApiUrl(options.pool ?? 'ru-1')}/v1/${
      this.projectId
    }`;
    this.token = options.token;

    if (!this.username) {
      throw new Error('User is required');
    }

    if (!this.password) {
      throw new Error('Password is required');
    }
  }

  /**
   * Summary storage information
   *
   * @see https://developers.selectel.ru/docs/cloud-services/cloud-storage/storage_swift_api/#%D0%BF%D0%BE%D0%BB%D1%83%D1%87%D0%B8%D1%82%D1%8C-%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D1%8E-%D0%BE-%D1%85%D1%80%D0%B0%D0%BD%D0%B8%D0%BB%D0%B8%D1%89%D0%B5
   */
  public getInfo() {
    return this.makeRequest<Response<void>>(this.storageUrl, 'HEAD');
  }

  //
  // Container operations
  //

  /**
   * Request could be of two types: with json and with string
   * @param {boolean} returnJson
   * @returns {Promise<Response | GetContainersData | void>}
   */
  public getContainers(returnJson = true) {
    if (returnJson) {
      const searchParams = new URLSearchParams([['format', 'json']]);
      return this.makeRequest<GetContainersData>(this.storageUrl, 'GET', {
        searchParams,
        headers: {
          accept: 'application/json',
          'Content-Type': 'application/json',
        },
        responseType: 'json',
        resolveBodyOnly: true,
      });
    }

    return this.makeRequest<Response<GetContainersData>>(this.storageUrl);
  }

  /**
   *
   * @param {string} params.container - new container name
   * @param {ContainerType} [params.type] - container type
   * @param {string} [params.metadata] - additional meta data
   * @returns {Promise<Response | void>}
   */
  public createContainer(params: CreateContainerParams) {
    validateParams(params);

    return this.makeRequest<Response>(
      `${this.storageUrl}/${params.container}`,
      'PUT',
      {
        headers: {
          'X-Container-Meta-Type': params.type || 'public',
          'X-Container-Meta-Some': params.metadata || '',
        },
      },
    );
  }

  /**
   * Receive container information
   * @param {string} params.container - Container name
   * @returns {Promise<Response | void>}
   */
  public getContainerInfo(params: RequiredParams) {
    validateParams(params);

    return this.makeRequest<Response>(`${this.storageUrl}/${params.container}`);
  }

  /**
   * Get a list of files data
   *
   * @todo: should we return void here too?
   */
  public getFiles(params: GetFilesParams) {
    validateParams(params);

    const searchParams = new URLSearchParams();

    if (typeof params.format === 'string') {
      searchParams.append('format', params.format);
    }

    if (typeof params.limit === 'number') {
      searchParams.append('limit', params.limit.toString());
    }

    if (typeof params.marker === 'string') {
      searchParams.append('marker', params.marker);
    }

    if (typeof params.prefix === 'string') {
      searchParams.append('prefix', params.prefix);
    }

    if (typeof params.delimiter === 'string') {
      searchParams.append('delimiter', params.delimiter);
    }

    return this.makeRequest(`${this.storageUrl}/${params.container}`, 'GET', {
      searchParams,
    }).then((response: Response) => {
      const files = parseFiles(response.body, params.format);

      return {
        files,
        filesAmount: +response.headers['x-container-object-count'],
        containerSize: +response.headers['x-container-bytes-used'],
        containerType: response.headers[
          'x-container-meta-type'
        ] as ContainerType,
      };
    });
  }

  //
  // Single file operations
  //


  /**
   * Get a file info from headers
   * @param {string} params.container - Container name
   * @returns {
   *  Promise<{
   *    'content-length': string,
   *    'content-type': string,
   *  }>
   * }
   */
  public getFileInfo(params: RequiredParams) {
    validateParams(params);

    const searchParams = new URLSearchParams();

    return this.makeRequest(`${this.storageUrl}/${params.container}`, 'HEAD', {
      searchParams,
    }).then((response: Response) => {
      return {
        'content-length': +response.headers['content-length'],
        'content-type': response.headers['content-type'],
      } as const;
    });
  }
  
  /**
   * Upload single file to Selectel storage
   * @param {object} params
   * @param {string} [params.fileName] in case when archive are passed, filename
   * can be omitted. In that case all archived files will be extracted within
   * container root, or it could be used as a folder name
   * @param {Buffer | string} params.file - file's buffer or local path
   * @returns {Promise<Response | void>}
   */
  public uploadFile(params: UploadFileParams): Promise<Response> {
    return Promise.resolve()
      .then(() => {
        validateParams(params);

        if (typeof params.file === 'string') {
          // return readFile(params.file);
          return fs.createReadStream(params.file);
        } else if (params.file instanceof strm.Stream) {
          return params.file;
        } else if (params.file instanceof Buffer) {
          // @thanks to https://stackoverflow.com/a/44091532/7252759
          const readable = new strm.Readable();
          // _read is required but you can noop it
          readable._read = () => null;
          readable.push(params.file);
          readable.push(null);
          return readable;
        }
      })
      .then((stream) => {
        const searchParams =
          typeof params.archive !== 'undefined'
            ? {
                searchParams: new URLSearchParams([
                  ['extract-archive', params.archive],
                ]),
              }
            : {};

        return this.makeRequest(
          `${this.storageUrl}/${params.container}${
            typeof params.fileName ? `/${params.fileName}` : ''
          }`,
          'PUT',
          {
            headers: {
              'X-Delete-At': params.deleteAt,
              'X-Delete-After': params.lifetime,
              Etag: params.etag,
              'X-Object-Meta': params.metadata,
            },
            ...searchParams,
            isStream: true,
          },
          stream,
        );
      });
  }

  /**
   * This method are allowed only for root users. Additional users even with
   * write permissions should user `deleteFile` method
   * @param {string} params.container - Container name where you want to delete
   * files
   * @param {string[]} params.files - files names
   * @returns {Promise<DeleteFilesReturn | void>}
   */
  public deleteFiles(params: DeleteFilesParams) {
    validateParams(params);
    if (!Array.isArray(params.files) || !params.files.length) {
      throw new Error('Files missed');
    }

    const fullPaths = params.files.map((file) => `${params.container}/${file}`);
    const body = fullPaths.join('\n');
    const searchParams = new URLSearchParams([['bulk-delete', 'true']]);

    return this.makeRequest<DeleteFilesReturn>(this.storageUrl, 'POST', {
      headers: {
        'Content-Type': 'text/plain',
      },
      body,
      searchParams,
      responseType: 'json',
      resolveBodyOnly: true,
    });
  }

  /**
   * @param {string} params.container
   * @param {string} params.file
   * @returns {Promise<Response | void>} statusCode "204" on success
   */
  public deleteFile(params: DeleteFileParams) {
    validateParams(params);
    if (typeof params.file !== 'string') {
      throw new Error('File missed');
    }

    const url = `${this.storageUrl}/${params.container}/${params.file}`;
    return this.makeRequest<Response>(url, 'DELETE');
  }

  /**
   * Authorize
   * @returns {Promise<{ expire: string, token: string }>} When you want
   * to extend class this could be helpful to memorize token. I.e. to redis
   */
  protected authorize() {
    return this.authorizationRequest().then(async (response) => {
      if (response) {
        const expire = new Date(response[1].token.expires_at).getTime();
        this.expireAuthToken = expire;
        this.token = response[0].headers['x-subject-token'] as string;

        return {
          expire,
          token: response[0].headers['x-subject-token'],
        };
      }
      return {};
    });
  }

  private authorizationRequest(): Promise<
    Response | AuthorizeJsonResponse | [Response, unknown]
  > {
    const response = got.post(authorizationUrl, {
      headers: {
        'Content-type': 'application/json',
      },
      json: {
        auth: {
          identity: {
            methods: ['password'],
            password: {
              user: {
                name: this.username,
                domain: { name: this.accountId },
                password: this.password,
              },
            },
          },
          scope: {
            project: {
              name: this.projectName,
              domain: { name: this.accountId },
            },
          },
        },
      },
      responseType: 'json',
    });
    // we need both: response and json-body
    return Promise.all([response, response.json()]);
  }

  private makeRequest<T>(
    url,
    method?,
    params?,
    stream?: strm.Stream,
  ): Promise<T> {
    const requestMethod = method || 'GET';
    const gotOptions = params || {};

    return new Promise<AuthorizeReturn | void>((resolve) => {
      if (this.expireAuthToken && this.expireAuthToken <= Date.now()) {
        this.token = null;
      }
      if (typeof this.token !== 'string') {
        resolve(this.authorize());
      } else {
        resolve();
      }
    }).then(() => {
      const options = {
        ...gotOptions,
        headers: {
          ...gotOptions.headers,
          'X-Auth-Token': this.token,
        },
      };
      const instance = got.extend(options);
      const client = selectMethod(instance, requestMethod);

      if (stream) {
        return new Promise((resolve, reject) => {
          stream
            .pipe(client(url, options))
            // TODO: we could implement 'uploadProgress' too?
            .on('response', (response: T) => resolve(response))
            .on('error', (error) => reject(error));
        });
      }
      return client(url, options);
    });
  }
}

function validateParams<T extends RequiredParams>(params: T) {
  if (typeof params?.container !== 'string' || !params?.container.length) {
    throw new Error('Container name missed');
  }
}

function parseFiles(body, format): string[] | FileObject[] {
  switch (format) {
    case 'json':
      return JSON.parse(body) as FileObject[];
    case 'xml':
      // I don't think we need to support xml
      throw new Error('Oops, xml is not currently supported');
    default:
      // remove last \n and split
      return body.trim().split('\n');
  }
}

function selectMethod(instance, method) {
  switch (method) {
    case 'HEAD':
      return instance.head;
    case 'POST':
      return instance.post;
    case 'PUT':
      return instance.put;
    case 'DELETE':
      return instance.delete;
    case 'GET':
    default:
      return instance.get;
  }
}
