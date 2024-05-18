import dotenv from 'dotenv';
import faker from 'faker';
import fs from 'fs';
import path from 'path';
import util from 'util';
import type { Response } from 'got';

import { SelectelStorageClient } from '../';

dotenv.config();
const readFile = util.promisify(fs.readFile);

describe('Authorization', () => {
  it('should receive token Keystone', () => {
    expect.assertions(2);
    const client = new SelectelStorageClient({
      accountId: process.env.ACCOUNT_ID,
      username: process.env.USER_ID,
      password: process.env.PASSWORD,
      projectId: process.env.PROJECT_ID,
      projectName: process.env.PROJECT_NAME,
    });

    return client.getInfo().then((response) => {
      expect(response).toBeDefined();
      expect((response as Response).statusCode).toBe(204);
    });
  });
});

describe('Methods', () => {
  let client: InstanceType<typeof SelectelStorageClient>;

  // authorize
  beforeAll(() => {
    client = new SelectelStorageClient({
      accountId: process.env.ACCOUNT_ID,
      username: process.env.USER_ID,
      password: process.env.PASSWORD,
      projectId: process.env.PROJECT_ID,
      projectName: process.env.PROJECT_NAME,
    });

    return client.getInfo().then((response) => {
      expect(response).toBeDefined();
      expect(response.statusCode).toBe(204);
    });
  });

  describe('getInfo', () => {
    it('should return status 204', async () => {
      expect.assertions(4);
      const response = await client.getInfo();

      expect(response).toBeDefined();
      expect(response.statusCode).toBe(204);
    });
  });

  describe('getContainers', () => {
    it('should return string body', () => {
      expect.assertions(3);
      return client.getContainers(false).then((response) => {
        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual(expect.any(String));
      });
    });

    it('should return json body', () => {
      expect.assertions(2);
      return client.getContainers().then((response) => {
        expect(response).toBeDefined();
        expect(response).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              bytes: expect.any(Number),
              count: expect.any(Number),
              last_modified: expect.any(String),
              name: expect.any(String),
              storage_policy_index: expect.any(Number),
            }),
          ]),
        );
      });
    });
  });

  describe('createContainer', () => {
    it('should create public container', () => {
      expect.assertions(2);
      return client
        .createContainer({
          container: faker.name.firstName(),
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);
        });
    });

    it('should create private container', () => {
      expect.assertions(2);
      return client
        .createContainer({
          container: faker.name.firstName(),
          type: 'private',
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);
        });
    });

    it('should throw when container name missed', () => {
      expect.assertions(1);
      try {
        client.createContainer({container: undefined});
      } catch (err) {
        expect(err).toEqual(new Error('Container name missed'));
      }
    });
  });

  describe('getContainerInfo', () => {
    it('should receive status 204', () => {
      expect.assertions(4);
      const container = faker.name.firstName();
      return client
        .createContainer({
          container,
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);

          return client.getContainerInfo({
            container,
          });
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(String(response.statusCode)).toMatch(/^200|204$/);
        });
    });

    it('should throw when container name missed', () => {
      expect.assertions(1);
      try {
        client.getContainerInfo({container: undefined});
      } catch (err) {
        expect(err).toEqual(new Error('Container name missed'));
      }
    });
  });

  describe('getFiles', () => {
    let container;

    beforeAll(() => {
      container = faker.name.firstName();

      return client
        .createContainer({
          container,
        })
        .then(() => {
          return Promise.all(
            [1, 2, 3].map((i) =>
              client.uploadFile({
                container,
                file: path.resolve(__dirname, 'image.png'),
                fileName: `image-${i}.png`,
              }),
            ),
          );
        });
    });

    it('should receive files from container', () => {
      expect.assertions(1);
      return client.getFiles({ container }).then((result) => {
        expect(result.files).toHaveLength(3);
      });
    });

    it('should receive files in json', () => {
      expect.assertions(1);
      return client.getFiles({ container, format: 'json' }).then((result) => {
        expect(result.files).toHaveLength(3);
      });
    });

    it('should receive files from marker', () => {
      expect.assertions(2);
      return client
        .getFiles({ container, marker: 'image-1.png' })
        .then((result) => {
          expect(result.files).toHaveLength(2);
          expect(result.files).toEqual(
            expect.arrayContaining(['image-2.png', 'image-3.png']),
          );
        });
    });

    it('should receive limited number of files', () => {
      expect.assertions(1);
      return client.getFiles({ container, limit: 1 }).then((result) => {
        expect(result.files).toHaveLength(1);
      });
    });
  });

  describe('uploadFile', () => {
    let container;

    beforeAll(() => {
      container = faker.name.firstName();

      return client.createContainer({
        container,
      });
    });

    it('should upload file from fs', () => {
      expect.assertions(2);

      return client
        .uploadFile({
          container,
          file: path.resolve(__dirname, 'image.png'),
          fileName: 'image.png',
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);
        });
    });

    it('should upload file within a folder', () => {
      expect.assertions(2);

      return client
        .uploadFile({
          container: `${container}/new-folder`,
          file: path.resolve(__dirname, 'image.png'),
          fileName: 'image.png',
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);
        });
    });

    it('should upload file from buffer', async () => {
      expect.assertions(2);

      const buffer = await readFile(path.resolve(__dirname, 'image.png'));

      return client
        .uploadFile({
          container,
          file: buffer,
          fileName: 'image.png',
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);
        });
    });

    it('should upload file from stream', async () => {
      expect.assertions(2);

      const stream = fs.createReadStream(path.resolve(__dirname, 'image.png'));

      return client
        .uploadFile({
          container,
          file: stream,
          fileName: 'image.png',
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);
        });
    });
  });

  describe('deleteFiles', () => {
    let container;

    beforeAll(() => {
      container = faker.name.firstName();

      return client
        .createContainer({
          container,
        })
        .then(() => {
          return Promise.all(
            [1, 2, 3].map((i) =>
              client.uploadFile({
                container,
                file: path.resolve(__dirname, 'image.png'),
                fileName: `image-${i}.png`,
              }),
            ),
          );
        });
    });

    it('should delete files', () => {
      expect.assertions(2);
      return client
        .deleteFiles({
          container,
          files: ['image-1.png', 'image-2.png', 'image-3.png'],
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response['Response Status']).toBe('200 OK');
        });
    });
  });

  describe('deleteFile', () => {
    beforeAll(() => {
      // use some of yours existed containers
      return client.uploadFile({
        container: 'logos',
        file: path.resolve(__dirname, 'image.png'),
        fileName: `image.png`,
      });
    });

    it('should delete file', () => {
      expect.assertions(2);
      return client
        .deleteFile({
          container: 'logos',
          file: 'image.png',
        })
        .then((response) => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(204);
        });
    });
  });
});
