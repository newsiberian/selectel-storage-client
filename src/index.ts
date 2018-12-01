import fs from 'fs';
import Stream from 'stream';
import request from 'request';
import rp from 'request-promise-native';

type Protocol = 1 | 2 | 3;
type ContainerType = 'public' | 'private';

const baseUri = (key = 'api') => `https://${key}.selcdn.ru`;

export default class SelectelStorageClient {
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
    return this.makeRequest({
      uri: this.storageUrl,
      method: 'GET',
      resolveWithFullResponse: true,
    }).catch(handleError);
  }

  /**
   * Summary storage information
   *
   */
  public getInfo() {
    const accountId =
      this.userId.indexOf('_') !== -1 ? this.userId.split('_')[0] : this.userId;
    return this.makeRequest({
      uri: baseUri(accountId),
      method: 'GET',
      resolveWithFullResponse: true,
    }).catch(handleError);
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
      return this.makeRequest({
        uri: baseUri(this.accountId),
        method: 'GET',
        qs: {
          format: 'json',
        },
      }).catch(handleError);
    }

    return this.makeRequest({
      method: 'GET',
      resolveWithFullResponse: true,
    }).catch(handleError);
  }

  public createContainer(params: {
    container: string;
    type?: ContainerType;
    metadata?: string;
  }) {
    validateParams(params);

    return this.makeRequest({
      uri: `${this.storageUrl}/${params.container}`,
      method: 'PUT',
      headers: {
        'X-Container-Meta-Type': params.type || 'public',
        'X-Container-Meta-Some': params.metadata || '',
      },
      resolveWithFullResponse: true,
    }).catch(handleError);
  }

  public getContainerInfo(params: { container: string }) {
    validateParams(params);

    return this.makeRequest({
      uri: `${this.storageUrl}/${params.container}`,
      method: 'GET',
      resolveWithFullResponse: true,
    }).catch(handleError);
  }

  public getFiles(params: {
    container: string;
    limit?: number;
    marker?: string;
    prefix?: string;
    delimiter?: string;
    format?: 'json' | 'xml';
  }) {
    validateParams(params);
    const qs = {} as {
      limit?: number;
      marker?: string;
      prefix?: string;
      delimiter?: string;
      format?: 'json' | 'xml';
    };

    if (typeof params.format === 'string') {
      qs.format = params.format;
    }

    if (typeof params.limit === 'number') {
      qs.limit = params.limit;
    }

    if (typeof params.marker === 'string') {
      qs.marker = params.marker;
    }

    if (typeof params.prefix === 'string') {
      qs.prefix = params.prefix;
    }

    if (typeof params.delimiter === 'string') {
      qs.delimiter = params.delimiter;
    }

    return this.makeRequest({
      uri: `${this.storageUrl}/${params.container}`,
      method: 'GET',
      qs,
      resolveWithFullResponse: true,
    })
      .then(response => {
        const files = parseFiles(response.body, params.format);

        return {
          files,
          filesAmount: +response.headers['x-container-object-count'],
          containerSize: +response.headers['x-container-bytes-used'],
          containerType: response.headers['x-container-meta-type'],
        };
      })
      .catch(handleError);
  }

  //
  // Single file operations
  //

  /**
   * Upload single file to Selectel storage
   * @param {object} params
   * @param {Buffer | string} params.file - file's buffer or local path
   * @returns {Promise<void>}
   */
  public uploadFile(params: {
    container: string;
    file: Buffer | Stream | string;
    fileName: string;
    deleteAt?: number;
    lifetime?: number;
    etag?: string;
    metadata?: string;
  }) {
    validateParams(params);

    return Promise.resolve()
      .then(
        (): Stream | Promise<Stream> => {
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
        return this.makeRequest(
          {
            uri: `${this.storageUrl}/${params.container}/${params.fileName}`,
            method: 'PUT',
            headers: {
              'X-Delete-At': params.deleteAt,
              'X-Delete-After': params.lifetime,
              Etag: params.etag,
              'X-Object-Meta': params.metadata,
            },
            resolveWithFullResponse: true,
          },
          true,
          stream,
        );
      })
      .catch(handleError);
  }

  public deleteFiles(params: { container: string; files: string[] }) {
    validateParams(params);
    if (!Array.isArray(params.files) || !params.files.length) {
      throw new Error('Files missed');
    }

    const fullPaths = params.files.map(file => `${params.container}/${file}`);
    const body = fullPaths.join('\n');

    return this.makeRequest({
      uri: this.storageUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      qs: {
        'bulk-delete': true,
      },
      body,
      resolveWithFullResponse: true,
    });
  }

  private authorize() {
    return rp({
      uri: `${baseUri()}${this.getAuthorizationPath()}`,
      ...this.getAuthorizationParams(),
    })
      .then(response => {
        if (response) {
          switch (this.proto) {
            case 1:
              this.expireAuthToken =
                parseInt(response.headers['x-expire-auth-token'], 10) * 1000 +
                Date.now();
              this.token = response.headers['x-auth-token'];
              break;
            case 2: {
              const parsedResponse = JSON.parse(response);
              this.expireAuthToken = new Date(
                parsedResponse.access.token.expires,
              ).getTime();
              this.token = parsedResponse.access.token.id;
              break;
            }
            case 3:
            default: {
              const parsedBody = JSON.parse(response.body);
              this.expireAuthToken = new Date(
                parsedBody.token.expires_at,
              ).getTime();
              this.token = response.headers['x-subject-token'];
            }
          }
        }
      })
      .catch(handleError);
  }

  private getAuthorizationPath() {
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

  private getAuthorizationParams() {
    switch (this.proto) {
      case 1:
        return {
          method: 'GET',
          headers: {
            'X-Auth-User': this.userId,
            'X-Auth-Key': this.password,
          },
          resolveWithFullResponse: true,
        };
      case 2:
        return {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            auth: {
              passwordCredentials: {
                username: this.userId,
                password: this.password,
              },
            },
          }),
        };
      case 3:
      default:
        return {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
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
          }),
          resolveWithFullResponse: true,
        };
    }
  }

  private makeRequest(params, isStream = false, stream?: Stream): Promise<any> {
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
        const { uri, ...rest } = params;
        const options = {
          ...rest,
          uri: typeof uri === 'string' ? uri : this.storageUrl,
          headers: {
            ...params.headers,
            'X-Auth-Token': this.token,
          },
        };

        if (isStream) {
          return stream.pipe(request(options));
        }
        return rp(options);
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

function parseFiles(body, format) {
  switch (format) {
    case 'json':
      return JSON.parse(body);
    case 'xml':
      // I don't think we need to support xml
      throw new Error('Oops, xml is not currently supported');
    default:
      // remove last \n and split
      return body.trim().split('\n');
  }
}
