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
    name: string;
    type?: ContainerType;
    metadata?: string;
  }) {
    if (!params) {
      throw new Error('Params missed');
    }

    if (typeof params.name !== 'string' || !params.name.length) {
      throw new Error('New container name must be provided');
    }

    return this.makeRequest({
      uri: `${this.storageUrl}/${params.name}`,
      method: 'PUT',
      headers: {
        'X-Container-Meta-Type': params.type || 'public',
        'X-Container-Meta-Some': params.metadata || '',
      },
      resolveWithFullResponse: true,
    }).catch(handleError);
  }

  public getContainerInfo(name: string) {
    if (typeof name !== 'string' || !name.length) {
      throw new Error('Container name missed');
    }

    return this.makeRequest({
      uri: `${this.storageUrl}/${name}`,
      method: 'GET',
      resolveWithFullResponse: true,
    }).catch(handleError);
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
          // json: true,
        };
    }
  }

  private makeRequest(params) {
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

        return rp({
          ...rest,
          uri: typeof uri === 'string' ? uri : this.storageUrl,
          headers: {
            ...params.headers,
            'X-Auth-Token': this.token,
          },
        });
      });
  }
}

function handleError(err) {
  throw new Error(err);
}
