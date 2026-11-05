'use strict';
// Validates website addresses and keeps the scanner away from private networks.
// The server fetches whatever URL a visitor types, so without this a visitor
// could point it at internal addresses (SSRF).
const dns = require('dns').promises;
const net = require('net');

class UserError extends Error {}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:')) return isPrivateAddress(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  return true;
}

function normalizeUrl(raw, { allowAnyPort = false } = {}) {
  let s = String(raw || '').trim();
  if (!s) throw new UserError('Enter your website address.');
  if (s.length > 300) throw new UserError('That address is too long.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) {
    throw new UserError("That doesn't look like a website address. Try something like yourbusiness.com.");
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new UserError('Use a regular website address.');
  if (u.username || u.password) throw new UserError('Use a regular website address.');
  if (!u.hostname.includes('.') && !net.isIP(u.hostname)) {
    throw new UserError("That doesn't look like a website address. Try something like yourbusiness.com.");
  }
  if (u.port && !allowAnyPort && !['80', '443'].includes(u.port)) throw new UserError('Use a regular website address.');
  return u.origin + u.pathname;
}

async function assertPublicHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) {
    if (isPrivateAddress(h)) throw new UserError("That address isn't a public website.");
    return;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(h)) throw new UserError("That address isn't a public website.");
  let addrs;
  try { addrs = await dns.lookup(h, { all: true }); } catch (e) {
    throw new UserError("We couldn't find that website. Check the address and try again.");
  }
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) {
    throw new UserError("That address isn't a public website.");
  }
}

module.exports = { UserError, isPrivateAddress, normalizeUrl, assertPublicHost };
