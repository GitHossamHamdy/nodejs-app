const request = require('supertest');
const app = require('../app');

describe('App', function() {

  describe('GET /', function() {
    it('has the default page', function(done) {
      request(app)
        .get('/')
        .expect(/Welcome to Express/, done);
    });

    it('responds with status 200', function(done) {
      request(app)
        .get('/')
        .expect(200, done);
    });

    it('responds with HTML content-type', function(done) {
      request(app)
        .get('/')
        .expect('Content-Type', /html/, done);
    });
  });

  describe('GET /nonexistent-route', function() {
    it('returns 404 for unknown routes', function(done) {
      request(app)
        .get('/nonexistent-route')
        .expect(404, done);
    });

    it('includes an error message in the 404 response', function(done) {
      request(app)
        .get('/nonexistent-route')
        .expect(/NotFoundError|Not Found|Cannot GET/, done);
    });
  });

  describe('HTTP methods', function() {
    it('rejects unsupported method on / with 404 (no route match)', function(done) {
      // Express's default generator app only defines GET for '/',
      // so other methods should fall through to the 404 handler.
      request(app)
        .post('/')
        .expect(404, done);
    });
  });

  describe('Security / headers', function() {
    it('does not leak the X-Powered-By header value beyond Express default (sanity check)', function(done) {
      request(app)
        .get('/')
        .expect(function(res) {
          if (res.headers['x-powered-by'] && res.headers['x-powered-by'] !== 'Express') {
            throw new Error('Unexpected X-Powered-By header value: ' + res.headers['x-powered-by']);
          }
        })
        .end(done);
    });
  });

  describe('GET /users', function() {
    it('responds with the users route text (default Express generator behavior)', function(done) {
      request(app)
        .get('/users')
        .expect(200)
        .expect(/respond with a resource/, done);
    });
  });

});