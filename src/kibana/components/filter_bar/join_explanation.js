define(function (require) {
  return function JoinExplanationFactory(Private, indexPatterns, Promise, $timeout) {

    var jQuery = require('jquery');
    var qtip = require('qtip2');
    require('css!bower_components/qtip2/jquery.qtip.min.css');

    function JoinExplanationHelper() {}

    JoinExplanationHelper.prototype = (function () {

      var fieldFormat = Private(require('registry/field_formats'));
      var _ = require('lodash');

      /**
       * Format the value as a date if the field type is date
       */
      function formatDate(fields, fieldName, value) {
        var field = _.find(fields, function (field) {
          return field.name === fieldName;
        });
        if (field && field.type === 'date') {
          var format = field.format;
          if (!format) {
            format = fieldFormat.getDefaultInstance('date');
          }
          return format.convert(value, 'html');
        }
        return value;
      }

      function formatMatch(f, matchType) {
        var match = Object.keys(f.query[matchType])[0];
        var matchQuery = f.query[matchType][match];

        if (matchQuery.constructor === Object) {
          return ' match on ' + match + ': <b>' + matchQuery.query + '</b> ';
        } else {
          return ' match on ' + match + ': <b>' + matchQuery + '</b> ';
        }
      }

      var initQtip = function (explanations) {
        jQuery('.qtip').qtip('destroy', true);
        $timeout(function () {

          jQuery('.filter').each(function (index) {
            var $el = jQuery(this);
            if ($el.hasClass('join')) {
              $el.qtip({
                content: {
                  title: 'Steps',
                  text: explanations[index]
                },
                position: {
                  my: 'top left',
                  at: 'bottom center'
                },
                hide: {
                  event: 'unfocus'
                },
                style: {
                  classes: 'qtip-light qtip-rounded qtip-shadow'
                }
              });
            }
          });
        });
        return Promise.resolve('done');
      };


      var createFilterLabel = function (f, fields) {
        var prop;
        if (f.query && f.query.query_string && f.query.query_string.query) {
          return ' query: <b>' + f.query.query_string.query + '</b> ';
        } else if (f.query && f.query.match) {
          return formatMatch(f, 'match');
        } else if (f.query && f.query.match_phrase) {
          return formatMatch(f, 'match_phrase');
        } else if (f.query && f.query.match_phrase_prefix) {
          return formatMatch(f, 'match_phrase_prefix');
        } else if (f.range) {
          prop = Object.keys(f.range)[0];
          return ' ' + prop + ': <b>' + formatDate(fields, prop, f.range[prop].gte) +
            '</b> to <b>' + formatDate(fields, prop, f.range[prop].lte) + '</b> ';
        } else if (f.dbfilter) {
          return ' ' + (f.dbfilter.negate ? 'NOT' : '') + ' dbfilter: <b>' + f.dbfilter.queryid + '</b> ';
        } else if (f.or) {
          return ' or filter <b>' + f.or.length + ' terms</b> ';
        } else if (f.exists) {
          return ' exists: <b>' + f.exists.field + '</b> ';
        } else if (f.script) {
          return ' script: script:<b>' + f.script.script + '</b> params: <b>' + f.script.params + '</b> ';
        } else if (f.missing) {
          return ' missing: <b>' + f.missing.field + '</b> ';
        } else if (f.not) {
          return ' NOT' + createFilterLabel(f.not, fields);
        } else if (f.geo_bounding_box) {
          prop = Object.keys(f.geo_bounding_box)[0];
          return ' ' + prop + ': <b>' + JSON.stringify(f.geo_bounding_box[prop].top_left, null, '') + '</b> to <b>'
            + JSON.stringify(f.geo_bounding_box[prop].bottom_right, null, '') + '</b> ';
        } else {
          return ' <font color="red">Unable to pretty print the filter:</font> ' +
            JSON.stringify(_.omit(f, '$$hashKey'), null, ' ') + ' ';
        }
      };


      var explainFilter = function (filter, indexId) {
        if (filter.range || filter.not) {
          // fields might be needed
          return indexPatterns.get(indexId).then(function (index) {
            return createFilterLabel(filter, index.fields);
          });
        } else {
          return createFilterLabel(filter);
        }
      };


      var explainFilterInMustNot = function (filter, indexId) {
        return 'NOT ' + explainFilter(filter, indexId);
      };


      var explainQueries = function (queries, indexId) {

        var promises = [];
        _.each(queries, function (query) {
          // in our case we have filtered query for now
          if (query.query && query.query.filtered && query.query.filtered.query) {
            promises.push(explainFilter({query: query.query.filtered.query}, indexId));
          }

          if (query.query && query.query.filtered && query.query.filtered.filter && query.query.filtered.filter.bool) {
            var must = query.query.filtered.filter.bool.must;
            var must_not = query.query.filtered.filter.bool.must_not;
            if (must instanceof Array && must.length > 0) {
              _.each(must, function (filter) {
                promises.push(explainFilter(filter, indexId));
              });
            }
            if (must_not instanceof Array && must_not.length > 0) {
              _.each(must_not, function (filter) {
                promises.push(explainFilterInMustNot(filter, indexId));
              });
            }
          }
        });

        return Promise.all(promises).then(function (filterExplanations) {
          var html = '<ul>';
          _.each(filterExplanations, function (explanation) {
            html += '<li>' + explanation + '</li>';
          });
          return html + '</ul>';
        });
      };


      var explainRelation = function (relation) {
        var promises = [];
        if (relation[0].queries instanceof Array && relation[0].queries.length > 0) {
          promises.push(explainQueries(relation[0].queries, relation[0].indices[0]));
        } else {
          promises.push(Promise.resolve(''));
        }


        if (relation[1].queries instanceof Array && relation[1].queries.length > 0) {
          promises.push(explainQueries(relation[1].queries, relation[1].indices[0]));
        } else {
          promises.push(Promise.resolve(''));
        }

        return Promise.all(promises).then(function (explanations) {
          var html =
            '<b>Relation:</b></br>' +
            '<table class="relation">' +
            '<tr>' +
            '<td>from: <b>' + relation[0].indices[0] + '.' + relation[0].path + '</b>' +
            (explanations[0] ? '</br>' + explanations[0] : '') +
            '</td>' +
            '<td>to: <b>' + relation[1].indices[0] + '.' + relation[1].path + '</b>' +
            (explanations[1] ? '</br>' + explanations[1] : '') +
            '</td>' +
            '</tr></table>';

          return html;
        });
      };


      var explainGroup = function (group) {
        var promises = [];
        _.each(group, function (sequence) {
          promises.push(explainJoinSequence(sequence));
        });

        return Promise.all(promises).then(function (groupSequenceExplanations) {
          var html =
            '<b>Group of relations:</b></br>' +
            '<table class="group">';
          _.each(groupSequenceExplanations, function (sequenceExplanation) {
            html += '<tr><td>' + sequenceExplanation + '</td></tr>';
          });
          return html + '</table>';
        });
      };


      var explainJoinSequence = function (join_sequence) {
        var promises = [];
        _.each(join_sequence, function (el) {
          if (el.relation) {
            promises.push(explainRelation(el.relation));
          } else if (el.group) {
            promises.push(explainGroup(el.group));
          }
        });

        return Promise.all(promises).then(function (sequenceElementExplanations) {
          var html = '<table class="sequence">';
          _.each(sequenceElementExplanations, function (element) {
            html += '<tr><td>' + element + '</td></tr>';
          });
          return html + '</table>';
        });
      };


      var getFilterExplanations = function (filters) {
        var promises = [];
        _.each(filters, function (f) {
          if (f.join_sequence) {
            promises.push(explainJoinSequence(f.join_sequence));
          } else {
            // Note: in future
            // compute the explanation for the other type of join filter like join_set here as well
            // it would be f.join.filters

            // for now push an empty explanation so array lenght is correct
            promises.push(Promise.resolve(''));
          }
        });

        return Promise.all(promises).then(function (results) {
          var filterExplanations = [];
          _.each(results, function (explanation) {
            filterExplanations.push(explanation);
          });
          return filterExplanations;
        });
      };


      return {
        getFilterExplanations: getFilterExplanations,
        initQtip: initQtip
      };
    })();

    return new JoinExplanationHelper();
  };
});
