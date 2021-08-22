import got from 'got';
import { URLSearchParams } from 'url';

import type { Response } from 'got';
import * as fs from 'fs';
import * as strm from 'stream';

export type Protocol = 1 | 2 | 3;
export type ContainerType = 'public' | 'private' | 'gallery';

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

export interface Params {
  userId: string;
  password: string;
  proto?: Protocol;
  token?: string;
  numericDomain?: number;
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

export interface GetContainersJsonReturn {
  name: string;
  count: number;
  bytes: number;
  type: ContainerType;
  /**
   * Container last modification date
   */
  last_modified: string;
}

export interface GetFileReturn {
  // TODO: add xml file interface when xml will be supported
  files: string[] | FileObject[];
  filesAmount: number;
  containerSize: number;
  containerType: ContainerType;
}

export interface DeleteFilesReturn {
  'Number Not Found': number;
  'Response Status': string;
  'Response Body': string;
  Errors?: string[];
  'Number Deleted': number;
}

const prefixUrl = (key: number | string = 'api') => `https://${key}.selcdn.ru`;

export class SelectelStorageClient {
  /**
   * userId is a public since it is required from outside when we want to cache
   * token and we have several selectel users in our app
   */
  public readonly userId: string;
  private readonly accountId: string;
  private readonly password: string;
  private readonly proto: Protocol;
  private readonly storageUrl: string;
  private numericDomain?: number;
  /**
   * Authorization token
   */
  private token?: string;
  private expireAuthToken?: number;

  private static extractAccountId(userId: string): string {
    return userId.indexOf('_') !== -1 ? userId.split('_')[0] : userId;
  }

  constructor(params: Params) {
    this.userId = params.userId;
    this.password = params.password;
    this.proto = params.proto || 3;
    this.accountId = SelectelStorageClient.extractAccountId(this.userId);
    this.storageUrl = `${prefixUrl()}/v1/SEL_${this.accountId}`;
    this.numericDomain = params.numericDomain;
    this.token = params.token;

    if (!this.userId) {
      throw new Error('User is required');
    }

    if (!this.password) {
      throw new Error('Password is required');
    }
  }

  /**
   * Account information
   */
  public getAccountInfo(): Promise<Response | void> {
    return this.makeRequest<Response>(this.storageUrl, 'HEAD').catch(
      handleError,
    );
  }

  /**
   * Summary storage information
   * @todo: this one always returns forbidden. event when call from curl
   */
  public getInfo(): Promise<Response | void> {
    return this.getNumericDomain()
      .then((numericDomain: number) =>
        this.makeRequest<Response>(prefixUrl(numericDomain), 'HEAD'),
      )
      .catch(handleError);
  }

  //
  // Container operations
  //

  /**
   * Request could be of two types: with json and with string
   * @param {boolean} returnJson
   * @returns {Promise<Response | GetContainersJsonReturn | void>}
   */
  public getContainers(
    returnJson = true,
  ): Promise<Response | GetContainersJsonReturn | void> {
    if (returnJson) {
      const searchParams = new URLSearchParams([['format', 'json']]);
      return this.getNumericDomain()
        .then((numericDomain: number) =>
          this.makeRequest<GetContainersJsonReturn>(
            prefixUrl(numericDomain),
            'GET',
            {
              searchParams,
              headers: {
                accept: 'application/json',
                'Content-Type': 'application/json',
              },
              responseType: 'json',
              resolveBodyOnly: true,
            },
          ),
        )
        .catch(handleError);
    }

    return this.makeRequest<Response>(this.storageUrl).catch(handleError);
  }

  /**
   *
   * @param {string} params.container - new container name
   * @param {ContainerType} [params.type] - container type
   * @param {string} [params.metadata] - additional meta data
   * @returns {Promise<Response | void>}
   */
  public createContainer(
    params: CreateContainerParams,
  ): Promise<Response | void> {
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
    ).catch(handleError);
  }

  /**
   * Receive container information
   * @param {string} params.container - Container name
   * @returns {Promise<Response | void>}
   */
  public getContainerInfo(params: RequiredParams): Promise<Response | void> {
    validateParams(params);

    return this.makeRequest<Response>(
      `${this.storageUrl}/${params.container}`,
    ).catch(handleError);
  }

  /**
   * Get a list of files data
   *
   * @param params
   * @todo: should we return void here too?
   */
  public getFiles(params: GetFilesParams): Promise<GetFileReturn> {
    return Promise.resolve()
      .then(() => {
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

        return this.makeRequest(
          `${this.storageUrl}/${params.container}`,
          'GET',
          {
            searchParams,
          },
        );
      })
      .then((response: Response): GetFileReturn => {
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
   * Upload single file to Selectel storage
   * @param {object} params
   * @param {string} [params.fileName] in case when archive are passed, filename
   * can be omitted. In that case all archived files will be extracted within
   * container root, or it could be used as a folder name
   * @param {Buffer | string} params.file - file's buffer or local path
   * @returns {Promise<Response | void>}
   */
  public uploadFile(params: UploadFileParams): Promise<Response | void> {
    return Promise.resolve()
      .then((): strm.Stream | Promise<strm.Stream> => {
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
  public deleteFiles(
    params: DeleteFilesParams,
  ): Promise<DeleteFilesReturn | void> {
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
  public deleteFile(params: DeleteFileParams): Promise<Response | void> {
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
  protected authorize(): Promise<AuthorizeReturn> {
    return this.authorizationRequest().then(async (response) => {
      if (response) {
        switch (this.proto) {
          case 1: {
            const expire =
              parseInt(
                (response as Response).headers['x-expire-auth-token'] as string,
                10,
              ) *
                1000 +
              Date.now();
            this.expireAuthToken = expire;
            this.token = (response as Response).headers[
              'x-auth-token'
            ] as string;

            return {
              expire,
              token: (response as Response).headers['x-auth-token'],
            };
          }
          case 2: {
            const expire = new Date(
              (response as AuthorizeJsonResponse).access.token.expires,
            ).getTime();
            this.expireAuthToken = expire;
            this.token = (response as AuthorizeJsonResponse).access.token.id;

            return {
              expire,
              token: (response as AuthorizeJsonResponse).access.token.id,
            };
          }
          case 3:
          default: {
            const expire = new Date(response[1].token.expires_at).getTime();
            this.expireAuthToken = expire;
            this.token = response[0].headers['x-subject-token'] as string;

            return {
              expire,
              token: response[0].headers['x-subject-token'],
            };
          }
        }
      }
      return {};
    });
  }

  protected loadNumericDomain(): Promise<Response> {
    return got.get({
      prefixUrl: prefixUrl('auth'),
      headers: {
        'X-Auth-User': this.userId,
        'X-Auth-Key': this.password,
      },
    });
  }

  private getAuthorizationPath(): string {
    switch (this.proto) {
      case 1:
        return 'auth/v1.0';
      case 2:
        return 'v2.0/tokens';
      case 3:
      default:
        return 'v3/auth/tokens';
    }
  }

  private authorizationRequest(): Promise<
    Response | AuthorizeJsonResponse | [Response, unknown]
  > {
    // CancelableRequest<unknown> | Request | Promise<[Response<unknown>, unknown]>
    const url = this.getAuthorizationPath();
    switch (this.proto) {
      case 1:
        return got.get(url, {
          prefixUrl: prefixUrl(),
          headers: {
            'X-Auth-User': this.userId,
            'X-Auth-Key': this.password,
          },
        });
      case 2:
        return got.post(url, {
          prefixUrl: prefixUrl(),
          headers: {
            'Content-type': 'application/json',
          },
          json: {
            auth: {
              passwordCredentials: {
                username: this.userId,
                password: this.password,
              },
            },
          },
          responseType: 'json',
          resolveBodyOnly: true,
        });
      case 3:
      default: {
        const response = got.post(url, {
          prefixUrl: prefixUrl(),
          headers: {
            'Content-type': 'application/json',
          },
          json: {
            auth: {
              identity: {
                methods: ['password'],
                password: {
                  user: {
                    id: this.userId,
                    password: this.password,
                  },
                },
              },
            },
          },
          responseType: 'json',
        });
        // we need both: response and json-body
        return Promise.all([response, response.json()]);
      }
    }
  }

  private getNumericDomain(): Promise<number | void> {
    return new Promise((resolve) => {
      if (typeof this.numericDomain === 'number') {
        resolve(this.numericDomain);
      }
      return this.loadNumericDomain().then((response) => {
        if (typeof response.headers['x-storage-url'] === 'string') {
          const numericDomain = +response.headers['x-storage-url']
            .split('//')[1]
            .split('.')[0];
          if (!isNaN(numericDomain)) {
            this.numericDomain = numericDomain;
            resolve(numericDomain);
          } else {
            throw new Error(
              'Unable to extract numeric domain from Selectel response headers',
            );
          }
        }
      });
    });
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

function handleError(err) {
  throw new Error(err);
}

function validateParams<T extends RequiredParams>(params: T) {
  if (!params) {
    throw new Error('Params missed');
  }

  if (typeof params.container !== 'string' || !params.container.length) {
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
