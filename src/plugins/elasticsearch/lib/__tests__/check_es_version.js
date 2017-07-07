import _ from 'lodash';
import Promise from 'bluebird';
import sinon from 'sinon';
import url from 'url';

import serverConfig from '../../../../../test/serverConfig';
import checkEsVersion from '../check_es_version';

describe('plugins/elasticsearch', function () {
  describe('lib/check_es_version', function () {
    let server;
    let plugin;

    beforeEach(function () {
      const get = sinon.stub().withArgs('elasticsearch.engineVersion').returns('^1.4.3');
      const config = function () { return { get: get }; };
      server = {
        log: _.noop,
        config: config,
        plugins: {
          elasticsearch: {
            client: {
              nodes: {}
            },
            status: {
              red: sinon.stub()
            },
            url: url.format(serverConfig.servers.elasticsearch)
          }
        }
      };
    });

    function setNodes(/* ...versions */) {
      const versions = _.shuffle(arguments);
      const nodes = {};
      let i = 0;

      while (versions.length) {
        const name = 'node-' + (++i);
        const version = versions.shift();

        const node = {
          version: version,
          http_address: 'http_address',
          ip: 'ip'
        };

        if (!_.isString(version)) _.assign(node, version);
        nodes[name] = node;
      }

      const client = server.plugins.elasticsearch.client;
      client.nodes.info = sinon.stub().returns(Promise.resolve({ nodes: nodes }));

    }

    // kibi: checks for version 2.3.5
    it('passes with 2.3.5 nodes', function () {
      setNodes('2.3.5');
      return checkEsVersion(server);
    });

    it('passes with nodes on different supported versions', function () {
      // NOTE: this cluster would not work, just a sanity check for the check function
      setNodes('2.3.5', '1.4.4');
      return checkEsVersion(server);
    });

    it('fails on other 2.3 versions', function () {
      setNodes('2.3.4');
      return checkEsVersion(server)
      .then(() => {
        throw new Error('Expected check to fail');
      })
      .catch(() => {});
    });
    // kibi: end

    it('passes with single a node that matches', function () {
      setNodes('1.4.3');
      return checkEsVersion(server);
    });

    it('passes with multiple nodes that satisfy', function () {
      setNodes('1.4.3', '1.4.4', '1.4.3-Beta1');
      return checkEsVersion(server);
    });

    it('fails with a single node that is out of date', function () {
      setNodes('1.4.4', '1.4.2', '1.4.5');
      return checkEsVersion(server)
      .then(function () {
        throw new Error('expected validation to fail');
      }, _.noop);
    });

    it('passes if that single node is a client node', function () {
      setNodes(
        '1.4.4',
        { version: '1.4.2', attributes: { client: 'true' } },
        '1.4.5'
      );

      return checkEsVersion(server);
    });

  });
});