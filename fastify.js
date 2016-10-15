'use strict'

const wayfarer = require('wayfarer')
const urlUtil = require('url')
const stripUrl = require('pathname-match')
const fastJsonStringify = require('fast-json-stringify')
const fastSafeStringify = require('fast-safe-stringify')
const Ajv = require('ajv')
const jsonParser = require('body/json')

const supportedMethods = ['GET', 'POST', 'PUT']
const ajv = new Ajv({ coerceTypes: true })

const payloadSchema = Symbol('payload-schema')
const querystringSchema = Symbol('querystring-schema')
const outputSchema = Symbol('output-schema')
const paramsSchema = Symbol('params-scehma')

const schemas = require('./lib/schemas.json')
const inputSchemaError = fastJsonStringify(schemas.inputSchemaError)

function build () {
  const router = wayfarer('/404')
  const map = new Map()
  router.on('/404', defaultRoute)

  // shorthand methods
  fastify.get = get
  fastify.post = post
  fastify.put = put
  // extended route
  fastify.route = route

  return fastify

  function fastify (req, res) {
    router(stripUrl(req.url), req, res)
  }

  function get (url, schema, handler) {
    return _route('GET', url, schema, handler)
  }

  function post (url, schema, handler) {
    return _route('POST', url, schema, handler)
  }

  function put (url, schema, handler) {
    return _route('PUT', url, schema, handler)
  }

  function _route (method, url, schema, handler) {
    if (!handler && typeof schema === 'function') {
      handler = schema
      schema = {}
    }
    return route({ method, url, schema, handler })
  }

  function route (opts) {
    if (supportedMethods.indexOf(opts.method) === -1) {
      throw new Error(`${opts.method} method is not supported!`)
    }

    if (!opts.handler) {
      throw new Error(`Missing handler function for ${opts.method}:${opts.url} route.`)
    }

    if (opts.schema && opts.schema.out) {
      opts[outputSchema] = fastJsonStringify(opts.schema.out)
    } else {
      opts[outputSchema] = fastSafeStringify
    }

    if (opts.schema && opts.schema.payload) {
      opts[payloadSchema] = ajv.compile(opts.schema.payload)
    }

    if (opts.schema && opts.schema.querystring) {
      opts[querystringSchema] = ajv.compile(opts.schema.querystring)
    }

    if (opts.schema && opts.schema.params) {
      opts[paramsSchema] = ajv.compile(opts.schema.params)
    }

    if (map.has(opts.url)) {
      if (map.get(opts.url)[opts.method]) {
        throw new Error(`${opts.method} already set for ${opts.url}`)
      }

      map.get(opts.url)[opts.method] = opts
    } else {
      const node = createNode(opts.url)
      node[opts.method] = opts
      map.set(opts.url, node)
    }
    return fastify
  }

  function bodyParsed (handle, params, req, res) {
    function parsed (err, body) {
      if (err) {
        res.statusCode = 422
        res.end()
        return
      }
      handleNode(handle, params, req, res, body, null)
    }
    return parsed
  }

  function createNode (url) {
    const node = {}

    router.on(url, function handle (params, req, res) {
      const handle = node[req.method]

      if (handle && req.method === 'GET') {
        handleNode(handle, params, req, res, null, urlUtil.parse(req.url, true).query)
      } else if (handle && (req.method === 'POST' || req.method === 'PUT')) {
        if (req.headers['content-type'] === 'application/json') {
          jsonParser(req, bodyParsed(handle, params, req, res))
        } else {
          res.statusCode = 415
          res.end()
        }
      } else {
        res.statusCode = 404
        res.end()
      }
    })

    return node
  }

  function handleNode (handle, params, req, res, body, query) {
    if (!handle) {
      res.statusCode = 404
      res.end()
    }

    if (handle[paramsSchema] && !handle[paramsSchema](params)) {
      res.statusCode = 400
      res.end(inputSchemaError(handle[paramsSchema].errors))
      return
    }

    if (handle[payloadSchema] && !handle[payloadSchema](body)) {
      res.statusCode = 400
      res.end(inputSchemaError(handle[payloadSchema].errors))
      return
    }

    if (handle[querystringSchema] && !handle[querystringSchema](query)) {
      res.statusCode = 400
      res.end(inputSchemaError(handle[querystringSchema].errors))
      return
    }

    const request = new Request(params, req, body, query)
    handle.handler(request, reply)

    function reply (err, statusCode, data) {
      if (err) {
        res.statusCode = 500
        res.end()
      }

      if (!data) {
        data = statusCode
        statusCode = 200
      }

      res.statusCode = statusCode
      res.end(handle[outputSchema](data))
    }
  }

  function defaultRoute (params, req, res) {
    res.statusCode = 404
    res.end()
  }

  function Request (params, req, body, query) {
    this.params = params
    this.req = req
    this.body = body
    this.query = query
  }
}

module.exports = build
