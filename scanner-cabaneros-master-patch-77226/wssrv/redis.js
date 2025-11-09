'use strict'
var events = require('events');
var emitter = new events.EventEmitter();
const redis = require('redis')
const { promisify } = require('util')
const ttl = 60 * 15;

const client = redis.createClient({
  host: process.env.redisHost
});

client.on("connect", () => {
  client.flushdb();
})

async function expire(...hash) {
  client.expire(...hash, ttl);
}

module.exports = {
  client,
  getAsync: promisify(client.get).bind(client),
  setAsync: promisify(client.set).bind(client),
  incrAsync: promisify(client.incr).bind(client),
  keysAsync: promisify(client.keys).bind(client),
  existsAsync: promisify(client.exists).bind(client),
  lpushAsync: promisify(client.lpush).bind(client),
  saddAsync: promisify(client.sadd).bind(client),
  sismemberAsync: promisify(client.sismember).bind(client),
  sremAsync: promisify(client.srem).bind(client),
  smembersAsync: promisify(client.smembers).bind(client),
  hmgetAsync: promisify(client.hmget).bind(client),
  hmsetAsync: promisify(client.hmset).bind(client),
  hgetAsync: promisify(client.hget).bind(client),
  hgetAllAsync: promisify(client.hgetall).bind(client),
  hsetAsync: promisify(client.hset).bind(client),
  hexistsAsync: promisify(client.hexists).bind(client),
  delAsync: promisify(client.del).bind(client),
  expire: expire,
  emitter: emitter,
}