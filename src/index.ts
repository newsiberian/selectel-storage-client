import fs from 'fs';
import got from 'got';
import Stream from 'stream';
import { URLSearchParams } from 'url';

export type Protocol = 1 | 2 | 3;
export type ContainerType = 'public' | 'private' | 'gallery';

export interface FileObject {
  bytes: number;
  content_type: string;
  hash: string;
  last_modified: string;
  name: string;
}

const baseUrl = (key = 'api') => `https://${key}.selcdn.ru`;

export class SelectelStorageClient {
  private readonly accountId: string;
  private readonly userId: string;
  private readonly password: string;
  private readonly proto: Protocol;
  private readonly storageUrl: string;
  /**
   * Authorization token
   */
  private token: string;
  private expireAuthToken: number;

  private static extractAccountId(userId: string): string {
    return userId.indexOf('_') !== -1 ? userId.split('_')[0] : userId;
  }

  constructor(params: { userId: string; password: string; proto?: Protocol }) {
    this.userId = params.userId;
    this.password = params.password;
    this.proto = params.proto || 3;
    this.accountId = SelectelStorageClient.extractAccountId(this.userId);
    this.storageUrl = `https://api.selcdn.ru/v1/SEL_${this.accountId}`;

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
  public getAccountInfo() {
    return this.makeRequest(this.storageUrl, 'HEAD').catch(handleError);
  }

  /**
   * Summary storage information
   * @todo: this one always returns forbidden. event when call from curl
   */
  public getInfo() {
    return this.makeRequest(baseUrl(this.accountId), 'HEAD').catch(handleError);
  }

  //
  // Container operations
  //

  /**
   * Request could be of two types: with json and with string
   * @param {boolean} returnJson
   * @returns {Promise<void>}
   */
  public getContainers(returnJson = true) {
    if (returnJson) {
      const query = new URLSearchParams([['format', 'json']]);
      return this.makeRequest(baseUrl(this.accountId), 'GET', {
        query,
        headers: {
          accept: 'application/json',
          'Content-Type': 'application/json',
        },
        // json: true,
      }).catch(handleError);
    }

    return this.makeRequest(this.storageUrl).catch(handleError);
  }

  /**
   *
   * @param {string} params.container - new container name
   * @param {ContainerType} [params.type] - container type
   * @param {string} [params.metadata] - additional meta data
   * @returns {Promise<any>}
   */
  public createContainer(params: {
    container: string;
    type?: ContainerType;
    metadata?: string;
  }) {
    validateParams(params);

    return this.makeRequest(`${this.storageUrl}/${params.container}`, 'PUT', {
      headers: {
        'X-Container-Meta-Type': params.type || 'public',
        'X-Container-Meta-Some': params.metadata || '',
      },
    }).catch(handleError);
  }

  /**
   * Receive container information
   * @param {string} params.container - Container name
   * @returns {Promise<any>}
   */
  public getContainerInfo(params: { container: string }) {
    validateParams(params);

    return this.makeRequest(`${this.storageUrl}/${params.container}`).catch(
      handleError,
    );
  }

  public getFiles(params: {
    container: string;
    limit?: number;
    marker?: string;
    prefix?: string;
    delimiter?: string;
    format?: 'json' | 'xml';
  }) {
    return Promise.resolve()
      .then(() => {
        validateParams(params);

        const query = new URLSearchParams();

        if (typeof params.format === 'string') {
          query.append('format', params.format);
        }

        if (typeof params.limit === 'number') {
          query.append('limit', params.limit.toString());
        }

        if (typeof params.marker === 'string') {
          query.append('marker', params.marker);
        }

        if (typeof params.prefix === 'string') {
          query.append('prefix', params.prefix);
        }

        if (typeof params.delimiter === 'string') {
          query.append('delimiter', params.delimiter);
        }

        return this.makeRequest(
          `${this.storageUrl}/${params.container}`,
          'GET',
          {
            query,
          },
        );
      })
      .then(response => {
        const files = parseFiles(response.body, params.format);

        return {
          files,
          filesAmount: +response.headers['x-container-object-count'],
          containerSize: +response.headers['x-container-bytes-used'],
          containerType: response.headers['x-container-meta-type'],
        } as {
          // TODO: add xml file interface when xml will be supported
          files: string[] | FileObject[];
          filesAmount: number;
          containerSize: number;
          containerType: ContainerType;
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
   * @returns {Promise<void>}
   */
  public uploadFile(params: {
    container: string;
    file: Buffer | Stream | string;
    fileName?: string;
    deleteAt?: number;
    lifetime?: number;
    etag?: string;
    metadata?: string;
    archive?: 'tar' | 'tar.gz' | 'gzip';
  }) {
    return Promise.resolve()
      .then(
        (): Stream | Promise<Stream> => {
          validateParams(params);

          if (typeof params.file === 'string') {
            // return readFile(params.file);
            return fs.createReadStream(params.file);
          } else if (params.file instanceof Stream) {
            return params.file;
          } else if (params.file instanceof Buffer) {
            // @thanks to https://stackoverflow.com/a/44091532/7252759
            const readable = new Stream.Readable();
            // _read is required but you can noop it
            readable._read = () => null;
            readable.push(params.file);
            readable.push(null);
            return readable;
          }
        },
      )
      .then(stream => {
        const query =
          typeof params.archive !== 'undefined'
            ? {
                query: new URLSearchParams([
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
            ...query,
            stream: true,
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
   * @param {{string[]}} params.files - file names
   * @returns {Promise<any>}
   */
  public deleteFiles(params: { container: string; files: string[] }) {
    validateParams(params);
    if (!Array.isArray(params.files) || !params.files.length) {
      throw new Error('Files missed');
    }

    const fullPaths = params.files.map(file => `${params.container}/${file}`);
    const body = fullPaths.join('\n');
    const query = new URLSearchParams([['bulk-delete', 'true']]);

    return this.makeRequest(this.storageUrl, 'POST', {
      headers: {
        'Content-Type': 'text/plain',
      },
      body,
      query,
    });
  }

  /**
   * @param {string} params.container
   * @param {string} params.file
   * @returns {Promise<any>} statusCode "204" on success
   */
  public deleteFile(params: { container: string; file: string }) {
    validateParams(params);
    if (typeof params.file !== 'string') {
      throw new Error('File missed');
    }

    const url = `${this.storageUrl}/${params.container}/${params.file}`;
    return this.makeRequest(url, 'DELETE');
  }

  /**
   * Authorize
   * @returns {Promise<{ expire: string, token: string } | void>} When you want
   * to extend class this could be helpful to memorize token. I.e. to redis
   */
  protected authorize(): Promise<{
    expire?: string | number;
    token?: string;
  }> {
    const client = got.extend({
      baseUrl: baseUrl(),
    });

    return this.getAuthorizationParams(client).then(response => {
      if (response) {
        switch (this.proto) {
          case 1: {
            const expire =
              parseInt(response.headers['x-expire-auth-token'], 10) * 1000 +
              Date.now();
            this.expireAuthToken = expire;
            this.token = response.headers['x-auth-token'];

            return {
              expire,
              token: response.headers['x-auth-token'],
            };
          }
          case 2: {
            const expire = new Date(
              response.body.access.token.expires,
            ).getTime();
            this.expireAuthToken = expire;
            this.token = response.body.access.token.id;

            return {
              expire,
              token: response.body.access.token.id,
            };
          }
          case 3:
          default: {
            const expire = new Date(response.body.token.expires_at).getTime();
            this.expireAuthToken = expire;
            this.token = response.headers['x-subject-token'];

            return {
              expire,
              token: response.headers['x-subject-token'],
            };
          }
        }
      }
      return {};
    });
  }

  private getAuthorizationPath(): string {
    switch (this.proto) {
      case 1:
        return '/auth/v1.0';
      case 2:
        return '/v2.0/tokens';
      case 3:
      default:
        return '/v3/auth/tokens';
    }
  }

  private getAuthorizationParams(client) {
    const url = this.getAuthorizationPath();
    switch (this.proto) {
      case 1:
        return client.get(url, {
          headers: {
            'X-Auth-User': this.userId,
            'X-Auth-Key': this.password,
          },
        });
      case 2:
        return client.post(url, {
          headers: {
            'Content-type': 'application/json',
          },
          body: {
            auth: {
              passwordCredentials: {
                username: this.userId,
                password: this.password,
              },
            },
          },
          json: true,
        });
      case 3:
      default:
        return client.post(url, {
          headers: {
            'Content-type': 'application/json',
          },
          body: {
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
          json: true,
        });
    }
  }

  private makeRequest(url, method?, params?, stream?: Stream): Promise<any> {
    const requestMethod = method || 'GET';
    const gotOptions = (params || {}) as got.GotOptions<null>;

    return Promise.resolve()
      .then(() => {
        if (this.expireAuthToken && this.expireAuthToken <= Date.now()) {
          this.token = null;
        }
        if (typeof this.token !== 'string') {
          return this.authorize();
        }
        return;
      })
      .then(() => {
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
              .on('response', response => resolve(response))
              .on('error', error => reject(error));
          });
        }
        return client(url, options);
      });
  }
}

function handleError(err) {
  throw new Error(err);
}

function validateParams(params) {
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
