import dotenv from 'dotenv';
import faker from 'faker';

import SelectelStorageClient from '../';

dotenv.config();

describe('Authorization', () => {
  it('should receive token via protocol v1.0 authorization', () => {
    expect.assertions(2);
    const client = new SelectelStorageClient({
      userId: process.env.USER_ID,
      password: process.env.PASSWORD,
      proto: 1,
    });

    return client.getAccountInfo().then(response => {
      expect(response).toBeDefined();
      expect(response.statusCode).toBe(200);
    });
  });

  it('should receive token via protocol v2.0 authorization', () => {
    expect.assertions(2);
    const client = new SelectelStorageClient({
      userId: process.env.USER_ID,
      password: process.env.PASSWORD,
      proto: 2,
    });

    return client.getAccountInfo().then(response => {
      expect(response).toBeDefined();
      expect(response.statusCode).toBe(200);
    });
  });

  it('should receive token via protocol v3 authorization', () => {
    expect.assertions(2);
    const client = new SelectelStorageClient({
      userId: process.env.USER_ID,
      password: process.env.PASSWORD,
      proto: 3,
    });

    return client.getAccountInfo().then(response => {
      expect(response).toBeDefined();
      expect(response.statusCode).toBe(200);
    });
  });
});

describe('Methods', () => {
  let client;

  // authorize
  beforeAll(() => {
    client = new SelectelStorageClient({
      userId: process.env.USER_ID,
      password: process.env.PASSWORD,
      proto: 3,
    });

    return client.getAccountInfo().then(response => {
      expect(response).toBeDefined();
      expect(response.statusCode).toBe(200);
    });
  });

  describe('getAccountInfo', () => {
    it('should return status 204', () => {
      expect.assertions(1);
      return client.getAccountInfo().then(response => {
        expect(response).toBeDefined();
        expect(response.statusCode).toBe(204);
      });
    });
  });

  describe('getInfo', () => {
    it('should return status 204', () => {
      expect.assertions(1);
      return client.getInfo().then(response => {
        expect(response).toBeDefined();
        expect(response.statusCode).toBe(204);
      });
    });
  });

  describe('getContainers', () => {
    it('should return string body', () => {
      expect.assertions(3);
      return client.getContainers(false).then(response => {
        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual(expect.any(String));
      });
    });

    it('should return json body', () => {
      expect.assertions(3);
      return client.getContainers().then(response => {
        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual(expect.any(String));
      });
    });
  });

  describe('createContainer', () => {
    it('should create public container', () => {
      expect.assertions(2);
      return client
        .createContainer({
          name: faker.name.firstName(),
        })
        .then(response => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);
        });
    });

    it('should create private container', () => {
      expect.assertions(2);
      return client
        .createContainer({
          name: faker.name.firstName(),
          type: 'private',
        })
        .then(response => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);
        });
    });

    it('should throw when params object missed', () => {
      expect.assertions(1);
      try {
        client.createContainer();
      } catch (err) {
        expect(err).toEqual(new Error('Params missed'));
      }
    });

    it('should throw when container name missed', () => {
      expect.assertions(1);
      try {
        client.createContainer({});
      } catch (err) {
        expect(err).toEqual(new Error('New container name must be provided'));
      }
    });
  });

  describe('getContainerInfo', () => {
    it('should receive status 204', () => {
      expect.assertions(2);
      const name = faker.name.firstName();
      return client
        .createContainer({
          name,
        })
        .then(response => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(201);

          return client.getContainerInfo(name);
        })
        .then(response => {
          expect(response).toBeDefined();
          expect(response.statusCode).toBe(204);
        });
    });

    it('should throw when container name missed', () => {
      expect.assertions(1);
      try {
        client.getContainerInfo();
      } catch (err) {
        expect(err).toEqual(new Error('Container name missed'));
      }
    });
  });
});
