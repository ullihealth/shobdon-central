#!/usr/bin/env node
// LOCAL stand-in for the Stripe REST API + hosted pages, for manually and
// browser-testing the billing flow (checkout -> webhook -> "Payment received",
// Customer Portal, invoices) against `wrangler pages dev` WITHOUT any real Stripe
// account or key. Listens on the port .dev.vars' STRIPE_API_BASE_URL points at
// (8799). Nothing here ever talks to the real Stripe. The signed webhook it sends
// uses the local-only dummy STRIPE_WEBHOOK_SECRET from .dev.vars.
//
//   node scripts/stripe-local-stub.mjs
//
// Implements just what the app calls: POST /v1/checkout/sessions,
// POST /v1/billing_portal/sessions, GET /v1/subscriptions/:id,
// GET /v1/invoices?customer=, POST /v1/customers/:id (no-op) plus a fake hosted
// "Checkout" page (/pay/:id) whose Pay button fires checkout.session.completed
// at the app's webhook and redirects to the success_url, and a fake Customer
// Portal page (/portal/:customer).
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'

const PORT = Number(process.env.STRIPE_STUB_PORT ?? 8799)
const APP = process.env.APP_BASE_URL ?? 'http://localhost:8788'
const dev = (key, fallback) => {
  try {
    return fs.readFileSync('.dev.vars', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1].trim() ?? fallback
  } catch {
    return fallback
  }
}
const WEBHOOK_SECRET = dev('STRIPE_WEBHOOK_SECRET', 'whsec_local_dev_only_dummy_secret')
const PRICE_PACK = dev('STRIPE_PRICE_PACK', 'price_pack_local')

const sessions = new Map()
const subscriptions = new Map()
let n = 0
const id = (p) => `${p}_stub_${Date.now()}_${++n}`
const readBody = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)) })
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
const html = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;max-width:520px;margin:3rem auto">${body}`) }

async function sendWebhook(event) {
  const raw = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex')
  const r = await fetch(`${APP}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: raw })
  return r.status
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname
  if (req.method === 'POST' && path === '/v1/checkout/sessions') {
    const form = new URLSearchParams(await readBody(req))
    const sid = id('cs')
    sessions.set(sid, { clientReferenceId: form.get('client_reference_id'), successUrl: form.get('success_url'), cancelUrl: form.get('cancel_url'), price: form.get('line_items[0][price]'), email: form.get('customer_email') })
    return json(res, 200, { id: sid, url: `http://localhost:${PORT}/pay/${sid}` })
  }
  if (req.method === 'POST' && path === '/v1/billing_portal/sessions') {
    const form = new URLSearchParams(await readBody(req))
    return json(res, 200, { url: `http://localhost:${PORT}/portal/${form.get('customer')}?return=${encodeURIComponent(form.get('return_url') ?? '')}` })
  }
  const sub = path.match(/^\/v1\/subscriptions\/(.+)$/)
  if (req.method === 'GET' && sub) {
    const s = subscriptions.get(sub[1])
    return json(res, 200, { id: sub[1], status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, default_payment_method: null, items: { data: [{ price: { id: s?.price ?? PRICE_PACK, unit_amount: 4400, currency: 'gbp' } }] } })
  }
  if (req.method === 'GET' && path === '/v1/invoices') {
    const customer = url.searchParams.get('customer')
    const has = [...subscriptions.values()].some((s) => s.customer === customer)
    return json(res, 200, { data: has ? [{ id: 'in_stub_1', number: 'STUB-0001', status: 'paid', amount_paid: 4400, currency: 'gbp', created: Math.floor(Date.now() / 1000), hosted_invoice_url: `http://localhost:${PORT}/invoice/in_stub_1` }] : [] })
  }
  if (req.method === 'POST' && path.startsWith('/v1/customers/')) { await readBody(req); return json(res, 200, { id: path.split('/').pop() }) }

  const pay = path.match(/^\/pay\/(.+)$/)
  if (req.method === 'GET' && pay) {
    const s = sessions.get(pay[1])
    if (!s) return json(res, 404, { error: 'unknown session' })
    return html(res, `<h2>Stripe Checkout <small>(local sandbox stub)</small></h2><p>Airfield Pack - £44.00 / month</p><p>${s.email ?? ''}</p><form method=POST action="/pay/${pay[1]}/complete"><button id=pay style="padding:.8rem 1.4rem;font-size:1.1rem">Pay £44.00 (test card 4242…)</button></form>`)
  }
  const done = path.match(/^\/pay\/(.+)\/complete$/)
  if (req.method === 'POST' && done) {
    await readBody(req)
    const s = sessions.get(done[1])
    if (!s) return json(res, 404, { error: 'unknown session' })
    const customer = id('cus'), subscription = id('sub')
    subscriptions.set(subscription, { customer, price: s.price })
    const status = await sendWebhook({ id: id('evt'), type: 'checkout.session.completed', data: { object: { id: done[1], client_reference_id: s.clientReferenceId, customer, subscription } } })
    console.log(`checkout ${done[1]} paid; webhook -> ${status}`)
    res.writeHead(303, { Location: s.successUrl }); return res.end()
  }
  if (req.method === 'GET' && path.startsWith('/portal/')) {
    return html(res, `<h2>Stripe Customer Portal <small>(local sandbox stub)</small></h2><p id=portal>Customer ${path.split('/')[2]}</p><p>Update payment method · Invoice history · Cancel subscription</p><a href="${url.searchParams.get('return') ?? '#'}">← Return to Airfield Central</a>`)
  }
  json(res, 404, { error: `stub: no route ${req.method} ${path}` })
}).listen(PORT, () => console.log(`Stripe local stub on ${PORT} (app ${APP})`))
