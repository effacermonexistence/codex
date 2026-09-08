#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const childProcess = require('child_process')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-accepted-unverified-boundary-'))
process.env.SCV_ROOT = root

const control = require(path.join(__dirname, 'scv-single-control-plane.js'))
const contract = require(path.join(__dirname, 'scv-contract-harness.js'))
const transition = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const authority = require(path.join(__dirname, 'dm-authority.js'))
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))

const BASE_MS = Date.now() - 120000
const AUTH = { authenticated_inbound: true, authentication_source: 'shared_secret' }

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function appendReceipt(receipt) {
  const file = path.join(root, 'logs', 'delivery-receipts.ndjson')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(receipt) + '\n')
}

function providerResponseEvidence(name, ordinal, variant = {}) {
  const transportAttemptId = sha256(`attempt-${name}-${ordinal}`)
  const canonicalBytes = Buffer.from(JSON.stringify({ status: 'success' }))
  const responseSha256 = sha256(canonicalBytes.toString('utf8'))
  const fileName = `manychat-send-${transportAttemptId}-${responseSha256}.raw.json`
  if (variant.provider_artifact !== 'missing') {
    const directory = path.join(root, 'logs', 'provider-send-responses')
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    fs.chmodSync(directory, 0o700)
    const bytes = variant.provider_artifact === 'tampered'
      ? Buffer.from(JSON.stringify({ status: 'success', tampered: true }))
      : canonicalBytes
    fs.writeFileSync(path.join(directory, fileName), bytes, { mode: 0o600 })
    fs.chmodSync(path.join(directory, fileName), 0o600)
  }
  return {
    provider_response_file: fileName,
    provider_response_sha256: responseSha256,
    provider_response_size_bytes: canonicalBytes.length,
    transport_attempt_id: transportAttemptId
  }
}

function makeScenario(name, bubbleCount = 1, variant = {}) {
  const threadId = `accepted-boundary-${name}`
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-price`,
    text: 'What do you charge per hour?',
    text_source: 'manychat_webhook',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubbles = Array.from({ length: bubbleCount }, (_, index) => ({
    text: index === 0
      ? 'The model rate is $150 an hour and regular sessions are $200 an hour.'
      : `pricing follow-up bubble ${index + 1}`
  }))
  const state = control.readControlState(root, threadId)
  const committed = control.commitControlDecision(root, first, state, {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'focused_boundary_harness' },
    raw_text: bubbles.map((bubble) => bubble.text).join('\n'),
    packet: { bubbles }
  })
  const attemptedAt = new Date(BASE_MS + 10000).toISOString()
  const status = variant.delivery_status || 'manychat_accepted_unverified'
  const attemptIndexes = Array.isArray(variant.attempt_indexes)
    ? variant.attempt_indexes.slice()
    : bubbles.map((_bubble, index) => index)
  for (const index of attemptIndexes) {
    control.appendControlHistoryEvent(root, {
      ...first,
      bubble_index: index,
      bubble: bubbles[index]
    }, 'assistant_attempted', { at: attemptedAt, delivery_status: status })
  }
  if (variant.ambiguous_attempt_group === true) {
    const other = {
      ...first,
      message_id: `${threadId}-other-packet`,
      text: 'another client turn before the next authenticated inbound',
      received_at: new Date(BASE_MS + 12000).toISOString()
    }
    control.appendControlHistoryEvent(root, other, 'user', { at: other.received_at })
    control.appendControlHistoryEvent(root, {
      ...other,
      bubble_index: 0,
      bubble: { text: 'another ambiguous accepted attempt' }
    }, 'assistant_attempted', {
      at: new Date(BASE_MS + 13000).toISOString(),
      delivery_status: 'manychat_accepted_unverified'
    })
  }

  const receiptCount = variant.receipt_count === undefined ? attemptIndexes.length : variant.receipt_count
  for (let ordinal = 0; ordinal < receiptCount; ordinal += 1) {
    const index = variant.duplicate_receipt === true && ordinal === receiptCount - 1
      ? attemptIndexes[0]
      : attemptIndexes[Math.min(ordinal, attemptIndexes.length - 1)]
    const bubble = bubbles[Math.min(index, bubbles.length - 1)]
    const providerEvidence = providerResponseEvidence(name, ordinal, variant)
    appendReceipt({
      at: new Date(BASE_MS + 11000 + ordinal).toISOString(),
      contact_id: threadId,
      thread_id: threadId,
      instagram_username: 'omar.system',
      message_id: first.message_id,
      bubble_index: index,
      control_receipt_sha256: committed.receipt.receipt_sha256,
      text_sha256: sha256(bubble.text),
      text_length: bubble.text.length,
      delivery_status: variant.receipt_delivery_status || 'manychat_accepted_unverified',
      delivery_accepted: variant.delivery_accepted === undefined ? true : variant.delivery_accepted,
      delivery_confirmed: variant.delivery_confirmed === undefined ? false : variant.delivery_confirmed,
      delivery_method: 'manychat_api_accepted_unverified',
      http_status: 200,
      manychat_status: 200,
      provider_response_file: providerEvidence.provider_response_file,
      provider_response_sha256: providerEvidence.provider_response_sha256,
      provider_response_size_bytes: providerEvidence.provider_response_size_bytes,
      provider_receipt_id_present: false,
      provider_receipt_id: '',
      provider_receipt_id_path: '',
      transport_attempt_id: providerEvidence.transport_attempt_id
    })
  }

  const next = {
    ...first,
    message_id: variant.same_message_id === true ? first.message_id : `${threadId}-design`,
    text: variant.same_message_id === true
      ? first.text
      : 'I want a black and grey raven and I would like to book it',
    received_at: new Date(variant.not_strictly_newer === true ? BASE_MS + 9000 : BASE_MS + 20000).toISOString()
  }
  let faultObserved = false
  if (variant.fault_after_state_write === true) {
    try {
      control.recordIngressEvent(root, next, { ...AUTH, test_fault_after_state_write: true })
    } catch (error) {
      faultObserved = String(error?.message || error).includes('accepted_unverified_test_fault_after_state_write')
    }
  }
  const ingress = control.recordIngressEvent(root, next, variant.authenticated === false ? {} : AUTH)
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  const priorHistory = history.events.filter((event) => String(event.message_id || '') !== next.message_id)
  return { threadId, first, next, bubbles, ingress, history, priorHistory, committed, faultObserved }
}

function makeInterleavedPacketScenario() {
  const threadId = 'accepted-boundary-forced-interleaving'
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-price`,
    text: 'What do you charge per hour?',
    text_source: 'manychat_webhook',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubbles = [
    { text: 'The model rate is $150 an hour.' },
    { text: 'Regular sessions are $200 an hour.' },
    { text: 'If that works, send me your design and placement.' }
  ]
  const committed = control.commitControlDecision(root, first, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'forced_interleaving' },
    raw_text: bubbles.map((bubble) => bubble.text).join('\n'),
    packet: { bubbles }
  })

  const publishBubble = (index) => {
    const evidence = providerResponseEvidence('forced-interleaving', index)
    const packet = {
      ...first,
      bubble_index: index,
      bubble: bubbles[index],
      control_receipt: committed.receipt
    }
    return control.appendAcceptedUnverifiedDeliveryEvidence(root, packet, {
      at: new Date(BASE_MS + 10000 + index).toISOString(),
      delivery_status: 'manychat_accepted_unverified'
    }, () => {
      const receipt = {
        at: new Date(BASE_MS + 14000 + index).toISOString(),
        contact_id: threadId,
        thread_id: threadId,
        instagram_username: 'omar.system',
        message_id: first.message_id,
        bubble_index: index,
        control_receipt_sha256: committed.receipt.receipt_sha256,
        text_sha256: sha256(bubbles[index].text),
        text_length: bubbles[index].text.length,
        delivery_status: 'manychat_accepted_unverified',
        delivery_accepted: true,
        delivery_confirmed: false,
        delivery_method: 'manychat_api_accepted_unverified',
        http_status: 200,
        manychat_status: 200,
        ...evidence,
        provider_receipt_id_present: false,
        provider_receipt_id: '',
        provider_receipt_id_path: ''
      }
      appendReceipt(receipt)
      return receipt
    })
  }

  publishBubble(0)
  const next = {
    ...first,
    message_id: `${threadId}-design`,
    text: 'I want a black and grey raven and I would like to book it',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  const ingress = control.recordIngressEvent(root, next, AUTH)
  const contextPublicationPending = control.conversationContextPublicationPending(root, threadId)
  control.recordIngressEvent(root, next, AUTH)
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  return {
    threadId,
    first,
    next,
    bubbles,
    ingress,
    contextPublicationPending,
    history
  }
}

function makePriorUnansweredCoalescenceScenario() {
  const threadId = 'accepted-boundary-prior-unanswered'
  const seed = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-seed`,
    text: 'Hi',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, seed, AUTH)
  control.appendControlHistoryEvent(root, {
    ...seed,
    bubble_index: 0,
    bubble: { text: 'Hey, tell me what you have in mind.' }
  }, 'assistant', { at: new Date(BASE_MS + 1000).toISOString(), delivery_status: 'success_visible' })
  const unanswered = {
    ...seed,
    message_id: `${threadId}-unanswered-a`,
    text: 'I also need to know the price',
    received_at: new Date(BASE_MS + 5000).toISOString()
  }
  control.recordIngressEvent(root, unanswered, AUTH)
  const prior = {
    ...seed,
    message_id: `${threadId}-prior-b`,
    text: 'I want a raven design too',
    received_at: new Date(BASE_MS + 10000).toISOString()
  }
  control.recordIngressEvent(root, prior, AUTH)
  const bubbles = [{ text: 'Raven designs work well in black and grey.' }, { text: 'I can send the form.' }]
  const committed = control.commitControlDecision(root, prior, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'coalescence_negative' },
    raw_text: bubbles.map((bubble) => bubble.text).join('\n'),
    packet: { bubbles }
  })
  const publish = (index) => {
    const evidence = providerResponseEvidence('prior-unanswered', index)
    const packet = { ...prior, bubble_index: index, bubble: bubbles[index], control_receipt: committed.receipt }
    return control.appendAcceptedUnverifiedDeliveryEvidence(root, packet, {
      at: new Date(BASE_MS + 12000 + index).toISOString(),
      delivery_status: 'manychat_accepted_unverified'
    }, () => {
      const receipt = {
        at: new Date(BASE_MS + 14000 + index).toISOString(),
        contact_id: threadId,
        thread_id: threadId,
        message_id: prior.message_id,
        bubble_index: index,
        control_receipt_sha256: committed.receipt.receipt_sha256,
        text_sha256: sha256(bubbles[index].text),
        text_length: bubbles[index].text.length,
        delivery_status: 'manychat_accepted_unverified',
        delivery_accepted: true,
        delivery_confirmed: false,
        delivery_method: 'manychat_api_accepted_unverified',
        http_status: 200,
        manychat_status: 200,
        ...evidence,
        provider_receipt_id_present: false,
        provider_receipt_id: '',
        provider_receipt_id_path: ''
      }
      appendReceipt(receipt)
      return receipt
    })
  }
  publish(0)
  const observer = {
    ...seed,
    message_id: `${threadId}-observer-c`,
    text: 'Yes please',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  const ingress = control.recordIngressEvent(root, observer, AUTH)
  publish(1)
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  return { threadId, unanswered, prior, observer, ingress, history }
}

function makeMultiEventPriceAnsweredScenario() {
  const threadId = 'accepted-boundary-multi-event-price-answered'
  const seed = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-seed`,
    text: 'Hi',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, seed, AUTH)
  control.appendControlHistoryEvent(root, {
    ...seed,
    bubble_index: 0,
    bubble: { text: 'Want me to send the form?' }
  }, 'assistant', { at: new Date(BASE_MS + 1000).toISOString(), delivery_status: 'success_visible' })
  const consent = {
    ...seed,
    message_id: `${threadId}-consent`,
    text: 'Sure thing',
    received_at: new Date(BASE_MS + 5000).toISOString()
  }
  control.recordIngressEvent(root, consent, AUTH)
  const price = {
    ...seed,
    message_id: `${threadId}-price`,
    text: 'How much is it though?',
    received_at: new Date(BASE_MS + 10000).toISOString()
  }
  control.recordIngressEvent(root, price, AUTH)
  const bubble = { text: 'The model rate is $150 an hour. I have sent the form too.' }
  const committed = control.commitControlDecision(root, price, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'multi_event_price_answered' },
    raw_text: bubble.text,
    packet: { bubbles: [bubble] }
  })
  const evidence = providerResponseEvidence('multi-event-price-answered', 0)
  const deliveryPacket = {
    ...price,
    bubble_index: 0,
    bubble,
    bubbles: [bubble],
    control_receipt: committed.receipt
  }
  control.appendAcceptedUnverifiedDeliveryEvidence(root, deliveryPacket, {
    at: new Date(BASE_MS + 12000).toISOString(),
    delivery_status: 'manychat_accepted_unverified'
  }, () => {
    const receipt = {
      at: new Date(BASE_MS + 14000).toISOString(),
      contact_id: threadId,
      thread_id: threadId,
      message_id: price.message_id,
      bubble_index: 0,
      control_receipt_sha256: committed.receipt.receipt_sha256,
      text_sha256: sha256(bubble.text),
      text_length: bubble.text.length,
      delivery_status: 'manychat_accepted_unverified',
      delivery_accepted: true,
      delivery_confirmed: false,
      delivery_method: 'manychat_api_accepted_unverified',
      http_status: 200,
      manychat_status: 200,
      ...evidence,
      provider_receipt_id_present: false,
      provider_receipt_id: '',
      provider_receipt_id_path: ''
    }
    appendReceipt(receipt)
    return receipt
  })
  const submitted = {
    ...seed,
    message_id: `${threadId}-submitted`,
    text: 'I just submitted',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  const ingress = control.recordIngressEvent(root, submitted, AUTH)
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  const projected = authority.loadRecentThreadHistory(submitted, 30)
  const plan = transition.deriveClosedTransitionPlan({
    ...submitted,
    message: submitted.text,
    live_message: submitted.text,
    recent_history: projected,
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      live_turn_form_submitted_signal: true
    }
  })
  return { threadId, consent, price, submitted, ingress, history, plan }
}

function makePublicationRaceScenario(name, accepted, recoverPreNetwork = false) {
  const threadId = `accepted-boundary-publication-${name}`
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-price`,
    text: 'What is the model rate?',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubble = { text: 'The model rate is $150 an hour.' }
  const committed = control.commitControlDecision(root, first, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'publication_race' },
    raw_text: bubble.text,
    packet: { bubbles: [bubble] }
  })
  const deliveryPacket = {
    ...first,
    bubble_index: 0,
    bubble,
    bubbles: [bubble],
    control_receipt: committed.receipt
  }
  const publication = control.beginAcceptedUnverifiedDeliveryPublication(root, deliveryPacket)
  const next = {
    ...first,
    message_id: `${threadId}-next`,
    text: 'I want a raven design',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  const ingress = control.recordIngressEvent(root, next, AUTH)
  const blockedDuringPublication = control.conversationContextPublicationPending(root, threadId)
  if (accepted) {
    const evidence = providerResponseEvidence(`publication-${name}`, 0)
    deliveryPacket.transport_response_received_at = new Date(BASE_MS + 15000).toISOString()
    control.appendAcceptedUnverifiedDeliveryEvidence(root, deliveryPacket, {
      at: deliveryPacket.transport_response_received_at,
      delivery_status: 'manychat_accepted_unverified',
      delivery_publication_id: publication.publication_id
    }, () => {
      const receipt = {
        at: new Date(BASE_MS + 21000).toISOString(),
        transport_response_received_at: deliveryPacket.transport_response_received_at,
        contact_id: threadId,
        thread_id: threadId,
        message_id: first.message_id,
        bubble_index: 0,
        control_receipt_sha256: committed.receipt.receipt_sha256,
        text_sha256: sha256(bubble.text),
        text_length: bubble.text.length,
        delivery_status: 'manychat_accepted_unverified',
        delivery_accepted: true,
        delivery_confirmed: false,
        delivery_method: 'manychat_api_accepted_unverified',
        http_status: 200,
        manychat_status: 200,
        ...evidence,
        provider_receipt_id_present: false,
        provider_receipt_id: '',
        provider_receipt_id_path: ''
      }
      appendReceipt(receipt)
      return receipt
    })
  } else {
    if (recoverPreNetwork) {
      control.recoverPreNetworkDeliveryPublication(root, deliveryPacket)
    } else {
      control.clearAcceptedUnverifiedDeliveryPublication(root, deliveryPacket, publication.publication_id)
    }
  }
  const blockedAfterTerminal = control.conversationContextPublicationPending(root, threadId)
  control.recordIngressEvent(root, next, AUTH)
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  return { threadId, first, next, bubble, ingress, blockedDuringPublication, blockedAfterTerminal, history }
}

function makeConfirmedPublicationRaceScenario(count, responseBeforeObserver) {
  const timing = responseBeforeObserver ? 'before' : 'after'
  const threadId = `accepted-boundary-confirmed-${count}-${timing}`
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-request`,
    text: 'Tell me about the model session',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubbles = Array.from({ length: count }, (_value, index) => ({ text: `confirmed packet bubble ${index + 1}` }))
  const committed = control.commitControlDecision(root, first, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'confirmed_publication_race' },
    raw_text: bubbles.map((bubble) => bubble.text).join('\n'),
    packet: { bubbles }
  })
  const publishConfirmed = (index, responseAt) => {
    const packet = {
      ...first,
      bubble_index: index,
      bubble: bubbles[index],
      bubbles,
      control_receipt: committed.receipt,
      transport_response_received_at: responseAt
    }
    const publication = control.beginAcceptedUnverifiedDeliveryPublication(root, packet)
    control.appendConfirmedDeliveryEvidence(root, packet, {
      at: responseAt,
      delivery_status: 'success_visible',
      delivery_publication_id: publication.publication_id
    }, () => ({
      at: responseAt,
      transport_response_received_at: responseAt,
      thread_id: threadId,
      contact_id: threadId,
      message_id: first.message_id,
      bubble_index: index,
      control_receipt_sha256: committed.receipt.receipt_sha256,
      text_sha256: sha256(bubbles[index].text),
      text_length: bubbles[index].text.length,
      delivery_status: 'success_visible',
      delivery_accepted: true,
      delivery_confirmed: true
    }))
  }
  for (let index = 0; index < count - 1; index += 1) {
    publishConfirmed(index, new Date(BASE_MS + 10000 + index).toISOString())
  }
  const finalIndex = count - 1
  const finalPacket = {
    ...first,
    bubble_index: finalIndex,
    bubble: bubbles[finalIndex],
    bubbles,
    control_receipt: committed.receipt
  }
  const finalPublication = control.beginAcceptedUnverifiedDeliveryPublication(root, finalPacket)
  const observer = {
    ...first,
    message_id: `${threadId}-observer`,
    text: 'I want a raven design',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  const ingress = control.recordIngressEvent(root, observer, AUTH)
  const responseAt = new Date(BASE_MS + (responseBeforeObserver ? 15000 : 25000)).toISOString()
  finalPacket.transport_response_received_at = responseAt
  control.appendConfirmedDeliveryEvidence(root, finalPacket, {
    at: responseAt,
    delivery_status: 'success_visible',
    delivery_publication_id: finalPublication.publication_id
  }, () => ({
    at: responseAt,
    transport_response_received_at: responseAt,
    thread_id: threadId,
    contact_id: threadId,
    message_id: first.message_id,
    bubble_index: finalIndex,
    control_receipt_sha256: committed.receipt.receipt_sha256,
    text_sha256: sha256(bubbles[finalIndex].text),
    text_length: bubbles[finalIndex].text.length,
    delivery_status: 'success_visible',
    delivery_accepted: true,
    delivery_confirmed: true
  }))
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  return { threadId, first, observer, ingress, history, count, responseBeforeObserver }
}

function makeMixedPublicationRaceScenario(count, finalAcceptedUnverified) {
  const suffix = finalAcceptedUnverified ? 'accepted-final' : 'confirmed-final'
  const threadId = `accepted-boundary-mixed-${count}-${suffix}`
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-request`,
    text: 'Tell me about the session',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubbles = Array.from({ length: count }, (_value, index) => ({ text: `mixed packet bubble ${index + 1}` }))
  const committed = control.commitControlDecision(root, first, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'mixed_publication_race' },
    raw_text: bubbles.map((bubble) => bubble.text).join('\n'),
    packet: { bubbles }
  })
  const packetFor = (index, responseAt) => ({
    ...first,
    bubble_index: index,
    bubble: bubbles[index],
    bubbles,
    control_receipt: committed.receipt,
    transport_response_received_at: responseAt
  })
  const receiptFor = (index, responseAt, acceptedUnverified) => {
    const evidence = providerResponseEvidence(`mixed-${count}-${suffix}`, index)
    return {
      at: responseAt,
      transport_response_received_at: responseAt,
      contact_id: threadId,
      thread_id: threadId,
      message_id: first.message_id,
      bubble_index: index,
      control_receipt_sha256: committed.receipt.receipt_sha256,
      text_sha256: sha256(bubbles[index].text),
      text_length: bubbles[index].text.length,
      delivery_status: acceptedUnverified ? 'manychat_accepted_unverified' : 'success_visible',
      delivery_accepted: true,
      delivery_confirmed: !acceptedUnverified,
      delivery_method: acceptedUnverified ? 'manychat_api_accepted_unverified' : 'manychat_visible',
      http_status: 200,
      manychat_status: 200,
      ...evidence,
      provider_receipt_id_present: false,
      provider_receipt_id: '',
      provider_receipt_id_path: ''
    }
  }
  const publish = (index, acceptedUnverified, responseAt, publication) => {
    const packet = packetFor(index, responseAt)
    const active = publication || control.beginAcceptedUnverifiedDeliveryPublication(root, packet)
    const receipt = receiptFor(index, responseAt, acceptedUnverified)
    if (acceptedUnverified) {
      control.appendAcceptedUnverifiedDeliveryEvidence(root, packet, {
        at: responseAt,
        delivery_status: 'manychat_accepted_unverified',
        delivery_publication_id: active.publication_id
      }, () => { appendReceipt(receipt); return receipt })
    } else {
      control.appendConfirmedDeliveryEvidence(root, packet, {
        at: responseAt,
        delivery_status: 'success_visible',
        delivery_publication_id: active.publication_id
      }, () => { appendReceipt(receipt); return receipt })
    }
  }
  for (let index = 0; index < count - 1; index += 1) {
    const accepted = finalAcceptedUnverified ? false : index === 0
    publish(index, accepted, new Date(BASE_MS + 10000 + index).toISOString())
  }
  const finalIndex = count - 1
  const finalResponseAt = new Date(BASE_MS + 15000).toISOString()
  const finalPacket = packetFor(finalIndex, finalResponseAt)
  const finalPublication = control.beginAcceptedUnverifiedDeliveryPublication(root, finalPacket)
  const observer = {
    ...first,
    message_id: `${threadId}-observer`,
    text: 'I want a raven design',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  const ingress = control.recordIngressEvent(root, observer, AUTH)
  publish(finalIndex, finalAcceptedUnverified, finalResponseAt, finalPublication)
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  return { threadId, first, observer, ingress, history, count }
}

function makeStrictReceipt({ name, threadId, messageId, bubble, bubbleIndex, controlReceiptSha256, responseAt, accepted }) {
  const evidence = providerResponseEvidence(name, bubbleIndex)
  return {
    at: responseAt,
    transport_response_received_at: responseAt,
    contact_id: threadId,
    thread_id: threadId,
    message_id: messageId,
    bubble_index: bubbleIndex,
    control_receipt_sha256: controlReceiptSha256,
    text_sha256: sha256(bubble.text),
    text_length: bubble.text.length,
    delivery_status: accepted ? 'manychat_accepted_unverified' : 'success_visible',
    delivery_accepted: true,
    delivery_confirmed: accepted === false,
    delivery_method: accepted ? 'manychat_api_accepted_unverified' : 'manychat_visible',
    http_status: 200,
    manychat_status: 200,
    ...evidence,
    provider_receipt_id_present: false,
    provider_receipt_id: '',
    provider_receipt_id_path: ''
  }
}

function makeMixedDirectCutScenario(count, acceptedFirst, deliveredCount) {
  const order = acceptedFirst ? 'accepted-confirmed' : 'confirmed-accepted'
  const threadId = `accepted-boundary-direct-mixed-${count}-${deliveredCount}-${order}`
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-a`,
    text: 'tell me how the session works',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubbles = Array.from({ length: count }, (_value, index) => ({
    text: `direct mixed ${order} bubble ${index + 1}`
  }))
  const committed = control.commitControlDecision(root, first, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'direct_mixed_cut' },
    raw_text: bubbles.map((bubble) => bubble.text).join('\n'),
    packet: { bubbles }
  })
  for (let index = 0; index < deliveredCount; index += 1) {
    const accepted = index % 2 === 0 ? acceptedFirst : !acceptedFirst
    const responseAt = new Date(BASE_MS + 10000 + index).toISOString()
    const packet = {
      ...first,
      bubble_index: index,
      bubble: bubbles[index],
      bubbles,
      control_receipt: committed.receipt,
      transport_response_received_at: responseAt
    }
    const receipt = makeStrictReceipt({
      name: threadId,
      threadId,
      messageId: first.message_id,
      bubble: bubbles[index],
      bubbleIndex: index,
      controlReceiptSha256: committed.receipt.receipt_sha256,
      responseAt,
      accepted
    })
    if (accepted) {
      control.appendAcceptedUnverifiedDeliveryEvidence(root, packet, {
        at: responseAt,
        delivery_status: 'manychat_accepted_unverified'
      }, () => { appendReceipt(receipt); return receipt })
    } else {
      const publication = control.beginAcceptedUnverifiedDeliveryPublication(root, packet)
      control.appendConfirmedDeliveryEvidence(root, packet, {
        at: responseAt,
        delivery_status: 'success_visible',
        delivery_publication_id: publication.publication_id
      }, () => { appendReceipt(receipt); return receipt })
    }
  }
  const observer = {
    ...first,
    message_id: `${threadId}-b`,
    text: 'i want a raven on my forearm',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  const ingress = control.recordIngressEvent(root, observer, AUTH)
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  return { threadId, first, observer, bubbles, history, ingress, deliveredCount }
}

function makeLateAcceptedCorrelationScenario(name, variant = {}) {
  const threadId = `accepted-boundary-late-correlation-${name}`
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-a`,
    text: 'what is the model rate',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubble = { text: 'the model rate is $150 an hour' }
  const committed = control.commitControlDecision(root, first, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'late_correlation' },
    raw_text: bubble.text,
    packet: { bubbles: [bubble] }
  })
  const responseAt = new Date(BASE_MS + 25000).toISOString()
  const packet = {
    ...first,
    bubble_index: 0,
    bubble,
    bubbles: [bubble],
    control_receipt: committed.receipt,
    transport_response_received_at: responseAt
  }
  const publication = control.beginAcceptedUnverifiedDeliveryPublication(root, packet)
  const observerB = {
    ...first,
    message_id: `${threadId}-b`,
    text: 'i want a raven design',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  control.recordIngressEvent(root, observerB, AUTH)
  if (variant.ambiguous_intervening === true) {
    control.recordIngressEvent(root, {
      ...first,
      message_id: `${threadId}-between`,
      text: 'also maybe on my forearm',
      received_at: new Date(BASE_MS + 22000).toISOString()
    }, AUTH)
  }
  const receipt = makeStrictReceipt({
    name: threadId,
    threadId,
    messageId: first.message_id,
    bubble,
    bubbleIndex: 0,
    controlReceiptSha256: committed.receipt.receipt_sha256,
    responseAt,
    accepted: true
  })
  control.appendAcceptedUnverifiedDeliveryEvidence(root, packet, {
    at: responseAt,
    delivery_status: 'manychat_accepted_unverified',
    delivery_publication_id: publication.publication_id
  }, () => { appendReceipt(receipt); return receipt })
  let trigger
  let ingress
  if (variant.duplicate_b === true) {
    trigger = observerB
    ingress = control.recordIngressEvent(root, trigger, AUTH)
  } else {
    trigger = {
      ...first,
      message_id: `${threadId}-c`,
      text: 'and around six inches',
      received_at: variant.equal_response_time === true
        ? responseAt
        : new Date(BASE_MS + 30000).toISOString()
    }
    ingress = control.recordIngressEvent(root, trigger, variant.unauthenticated_c === true ? {} : AUTH)
  }
  const history = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  const attempt = history.events.find((event) =>
    event.role === 'assistant_attempted' && event.message_id === first.message_id
  )
  return { threadId, first, observerB, trigger, ingress, history, attempt }
}

function makeAtomicMixedConfirmedCrashScenario(count, faultPoint) {
  const threadId = `accepted-boundary-atomic-crash-${count}-${faultPoint}`
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-a`,
    text: 'tell me about booking',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubbles = Array.from({ length: count }, (_value, index) => ({ text: `atomic crash bubble ${index + 1}` }))
  const committed = control.commitControlDecision(root, first, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'atomic_mixed_confirmed_crash' },
    raw_text: bubbles.map((bubble) => bubble.text).join('\n'),
    packet: { bubbles }
  })
  for (let index = 0; index < count - 1; index += 1) {
    const responseAt = new Date(BASE_MS + 10000 + index).toISOString()
    const packet = {
      ...first,
      bubble_index: index,
      bubble: bubbles[index],
      bubbles,
      control_receipt: committed.receipt,
      transport_response_received_at: responseAt
    }
    const receipt = makeStrictReceipt({
      name: threadId,
      threadId,
      messageId: first.message_id,
      bubble: bubbles[index],
      bubbleIndex: index,
      controlReceiptSha256: committed.receipt.receipt_sha256,
      responseAt,
      accepted: true
    })
    control.appendAcceptedUnverifiedDeliveryEvidence(root, packet, {
      at: responseAt,
      delivery_status: 'manychat_accepted_unverified'
    }, () => { appendReceipt(receipt); return receipt })
  }
  const finalIndex = count - 1
  const responseAt = new Date(BASE_MS + 15000).toISOString()
  const finalPacket = {
    ...first,
    bubble_index: finalIndex,
    bubble: bubbles[finalIndex],
    bubbles,
    control_receipt: committed.receipt,
    transport_response_received_at: responseAt
  }
  const publication = control.beginAcceptedUnverifiedDeliveryPublication(root, finalPacket)
  const observer = {
    ...first,
    message_id: `${threadId}-b`,
    text: 'i want a raven design',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  control.recordIngressEvent(root, observer, AUTH)
  const finalReceipt = makeStrictReceipt({
    name: threadId,
    threadId,
    messageId: first.message_id,
    bubble: bubbles[finalIndex],
    bubbleIndex: finalIndex,
    controlReceiptSha256: committed.receipt.receipt_sha256,
    responseAt,
    accepted: false
  })
  let receiptWrites = 0
  const persistFinalReceipt = () => {
    receiptWrites += 1
    appendReceipt(finalReceipt)
    return finalReceipt
  }
  const faultExtra = {
    at: responseAt,
    delivery_status: 'success_visible',
    delivery_publication_id: publication.publication_id,
    [`test_fault_${faultPoint}`]: true
  }
  let faultObserved = false
  const historyFile = path.join(root, 'thread-history', `${threadId}.json`)
  const originalRenameSync = fs.renameSync
  let firstCallHistoryWrites = 0
  fs.renameSync = function wrappedRenameSync(source, destination) {
    if (destination === historyFile) firstCallHistoryWrites += 1
    return originalRenameSync.call(fs, source, destination)
  }
  try {
    control.appendConfirmedDeliveryEvidence(root, finalPacket, faultExtra, persistFinalReceipt)
  } catch (error) {
    faultObserved = String(error?.message || '').includes(`confirmed_delivery_test_fault_${faultPoint}`)
  } finally {
    fs.renameSync = originalRenameSync
  }

  if (['after_receipt', 'before_history_write', 'after_history_write'].includes(faultPoint)) {
    control.appendConfirmedDeliveryEvidence(root, finalPacket, {
      at: responseAt,
      delivery_status: 'success_visible',
      delivery_publication_id: publication.publication_id
    }, persistFinalReceipt)
  } else if (faultPoint === 'after_publication_clear') {
    control.recordIngressEvent(root, observer, AUTH)
    control.recordIngressEvent(root, observer, AUTH)
  }
  const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
  const receipts = fs.readFileSync(path.join(root, 'logs', 'delivery-receipts.ndjson'), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .filter((receipt) => receipt.message_id === first.message_id)
  return {
    threadId,
    first,
    observer,
    history,
    receipts,
    receiptWrites,
    faultObserved,
    firstCallHistoryWrites,
    faultPoint
  }
}

function makePublicationBeginStaleRaceScenario() {
  const threadId = 'accepted-boundary-publication-begin-stale-race'
  const first = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: `${threadId}-first`,
    text: 'What is the model rate?',
    received_at: new Date(BASE_MS).toISOString()
  }
  control.recordIngressEvent(root, first, AUTH)
  const bubble = { text: 'The model rate is $150 an hour.' }
  const committed = control.commitControlDecision(root, first, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'publication_begin_stale_race' },
    raw_text: bubble.text,
    packet: { bubbles: [bubble] }
  })
  const stalePacket = {
    ...first,
    bubble_index: 0,
    bubble,
    bubbles: [bubble],
    control_receipt: committed.receipt
  }
  const newer = {
    ...first,
    message_id: `${threadId}-newer`,
    text: 'I want a raven design',
    received_at: new Date(BASE_MS + 20000).toISOString()
  }
  control.recordIngressEvent(root, newer, AUTH)
  let error = ''
  try { control.beginAcceptedUnverifiedDeliveryPublication(root, stalePacket) } catch (caught) { error = String(caught?.message || caught) }
  return {
    threadId,
    error,
    publicationPending: control.conversationContextPublicationPending(root, threadId),
    history: JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  }
}

function makeControlLockRecoveryScenarios() {
  const lockDirectory = path.join(root, 'control-locks')
  fs.mkdirSync(lockDirectory, { recursive: true })

  const corruptThread = 'accepted-boundary-corrupt-stale-lock'
  const corruptLock = path.join(lockDirectory, `${corruptThread}.lock`)
  fs.writeFileSync(corruptLock, '{truncated', { mode: 0o600 })
  const staleTime = new Date(Date.now() - 60000)
  fs.utimesSync(corruptLock, staleTime, staleTime)
  const corruptPacket = {
    contact_id: corruptThread,
    thread_id: corruptThread,
    message_id: `${corruptThread}-message`,
    text: 'hello',
    received_at: new Date(BASE_MS).toISOString()
  }
  const corruptRecovered = control.recordIngressEvent(root, corruptPacket, AUTH)

  const replacementThread = 'accepted-boundary-lock-owner-replacement'
  const replacementLock = path.join(lockDirectory, `${replacementThread}.lock`)
  const bubble = { text: 'accepted visible response' }
  const evidence = providerResponseEvidence('lock-owner-replacement', 0)
  const responseAt = new Date(BASE_MS + 10000).toISOString()
  const replacementNonce = 'b'.repeat(64)
  control.appendAcceptedUnverifiedDeliveryEvidence(root, {
    contact_id: replacementThread,
    thread_id: replacementThread,
    message_id: `${replacementThread}-message`,
    bubble_index: 0,
    bubble
  }, {
    at: responseAt,
    delivery_status: 'manychat_accepted_unverified'
  }, () => {
    const receipt = {
      at: responseAt,
      transport_response_received_at: responseAt,
      contact_id: replacementThread,
      thread_id: replacementThread,
      message_id: `${replacementThread}-message`,
      bubble_index: 0,
      control_receipt_sha256: sha256('lock-owner-replacement-control'),
      text_sha256: sha256(bubble.text),
      text_length: bubble.text.length,
      delivery_status: 'manychat_accepted_unverified',
      delivery_accepted: true,
      delivery_confirmed: false,
      delivery_method: 'manychat_api_accepted_unverified',
      http_status: 200,
      manychat_status: 200,
      ...evidence,
      provider_receipt_id_present: false,
      provider_receipt_id: '',
      provider_receipt_id_path: ''
    }
    appendReceipt(receipt)
    fs.unlinkSync(replacementLock)
    fs.writeFileSync(replacementLock, JSON.stringify({
      pid: process.pid,
      owner_nonce: replacementNonce,
      at: new Date().toISOString(),
      control_plane_id: control.SCV_SINGLE_CONTROL_PLANE_ID
    }) + '\n', { mode: 0o600 })
    return receipt
  })
  const replacementPreserved = fs.existsSync(replacementLock) &&
    JSON.parse(fs.readFileSync(replacementLock, 'utf8')).owner_nonce === replacementNonce
  fs.unlinkSync(replacementLock)

  const liveThread = 'accepted-boundary-live-stale-lock'
  const liveLock = path.join(lockDirectory, `${liveThread}.lock`)
  fs.writeFileSync(liveLock, JSON.stringify({
    pid: process.pid,
    owner_nonce: 'c'.repeat(64),
    at: new Date(Date.now() - 60000).toISOString(),
    control_plane_id: control.SCV_SINGLE_CONTROL_PLANE_ID
  }) + '\n', { mode: 0o600 })
  fs.utimesSync(liveLock, staleTime, staleTime)
  const waitStarted = Date.now()
  let liveError = ''
  try {
    control.recordIngressEvent(root, {
      contact_id: liveThread,
      thread_id: liveThread,
      message_id: `${liveThread}-message`,
      text: 'hello',
      received_at: new Date(BASE_MS).toISOString()
    }, AUTH)
  } catch (caught) {
    liveError = String(caught?.message || caught)
  }
  const liveWaitMs = Date.now() - waitStarted
  const liveLockPreserved = fs.existsSync(liveLock)
  fs.unlinkSync(liveLock)

  return {
    corruptRecovered,
    replacementPreserved,
    liveError,
    liveWaitMs,
    liveLockPreserved
  }
}

function waitForFile(file, timeoutMs = 8000) {
  const started = Date.now()
  const wait = new Int32Array(new SharedArrayBuffer(4))
  while (!fs.existsSync(file) && Date.now() - started < timeoutMs) {
    Atomics.wait(wait, 0, 0, 10)
  }
  return fs.existsSync(file)
}

function makeControlLockRecoveryCoordinatorRaceScenario() {
  const fixture = fs.mkdtempSync(path.join(root, 'lock-recovery-race-'))
  const threadId = 'accepted-boundary-stale-lock-reaper-race'
  const lockDirectory = path.join(root, 'control-locks')
  const lockFile = path.join(lockDirectory, `${threadId}.lock`)
  const staleTime = new Date(Date.now() - 60000)
  fs.writeFileSync(lockFile, JSON.stringify({
    pid: 99999999,
    owner_nonce: 'd'.repeat(64),
    at: staleTime.toISOString(),
    control_plane_id: control.SCV_SINGLE_CONTROL_PLANE_ID
  }) + '\n', { mode: 0o600 })
  fs.utimesSync(lockFile, staleTime, staleTime)

  const modulePath = path.join(__dirname, 'scv-single-control-plane.js')
  const childSource = String.raw`
    const fs = require('fs')
    const [modulePath, root, threadId, mode, fixture] = process.argv.slice(1)
    const lock = require('path').join(root, 'control-locks', threadId + '.lock')
    const recovery = require('path').join(root, 'control-locks', threadId + '.recovery')
    const signal = (name, value = '') => fs.writeFileSync(require('path').join(fixture, name), String(value))
    const waitFor = (name, timeout = 12000) => {
      const started = Date.now(); const wait = new Int32Array(new SharedArrayBuffer(4))
      while (!fs.existsSync(require('path').join(fixture, name))) {
        if (Date.now() - started > timeout) throw new Error('child_barrier_timeout:' + name)
        Atomics.wait(wait, 0, 0, 10)
      }
    }
    if (mode === 'reaper1') {
      const originalUnlink = fs.unlinkSync
      const originalOpen = fs.openSync
      let staleUnlinkSeen = false
      let primaryOpenCount = 0
      fs.unlinkSync = function (file, ...args) {
        if (file === lock && !staleUnlinkSeen) {
          staleUnlinkSeen = true
          signal('reaper1-coordinator-owned')
          waitFor('allow-stale-unlink')
        }
        return originalUnlink.call(fs, file, ...args)
      }
      fs.openSync = function (file, flags, ...args) {
        if (file === lock && flags === 'wx') {
          primaryOpenCount += 1
          if (primaryOpenCount === 2) {
            signal('reaper1-gap-open')
            waitFor('allow-reaper1-reacquire')
          }
        }
        return originalOpen.call(fs, file, flags, ...args)
      }
    } else if (mode === 'reaper2') {
      const originalOpen = fs.openSync
      fs.openSync = function (file, flags, ...args) {
        try { return originalOpen.call(fs, file, flags, ...args) }
        catch (error) {
          if (file === recovery && flags === 'wx' && error?.code === 'EEXIST') {
            signal('reaper2-coordinator-blocked')
          }
          throw error
        }
      }
    }
    const control = require(modulePath)
    try {
      control.withThreadControlLock(root, threadId, () => {
        const owner = JSON.parse(fs.readFileSync(lock, 'utf8'))
        signal(mode + '-critical', owner.owner_nonce)
        if (mode === 'reaper2') waitFor('release-reaper2', 15000)
      })
      signal(mode + '-result', 'ok')
    } catch (error) {
      signal(mode + '-result', String(error?.message || error))
    }
  `
  const spawn = (mode) => childProcess.spawn(process.execPath, [
    '-e', childSource, modulePath, root, threadId, mode, fixture
  ], { stdio: 'ignore' })
  const reaper1 = spawn('reaper1')
  const coordinatorOwned = waitForFile(path.join(fixture, 'reaper1-coordinator-owned'))
  const reaper2 = spawn('reaper2')
  const reaper2Blocked = waitForFile(path.join(fixture, 'reaper2-coordinator-blocked'))
  fs.writeFileSync(path.join(fixture, 'allow-stale-unlink'), '1')
  const gapOpen = waitForFile(path.join(fixture, 'reaper1-gap-open'))
  const winnerAcquired = waitForFile(path.join(fixture, 'reaper2-critical'))
  const replacementNonce = winnerAcquired
    ? fs.readFileSync(path.join(fixture, 'reaper2-critical'), 'utf8')
    : ''
  const ordinary = spawn('ordinary')
  fs.writeFileSync(path.join(fixture, 'allow-reaper1-reacquire'), '1')
  const reaper1Finished = waitForFile(path.join(fixture, 'reaper1-result'), 8000)
  const ordinaryFinished = waitForFile(path.join(fixture, 'ordinary-result'), 8000)
  const reaper1Result = reaper1Finished ? fs.readFileSync(path.join(fixture, 'reaper1-result'), 'utf8') : ''
  const ordinaryResult = ordinaryFinished ? fs.readFileSync(path.join(fixture, 'ordinary-result'), 'utf8') : ''
  const replacementSurvived = fs.existsSync(lockFile) &&
    JSON.parse(fs.readFileSync(lockFile, 'utf8')).owner_nonce === replacementNonce
  const criticalFilesBeforeRelease = fs.readdirSync(fixture).filter((name) => name.endsWith('-critical'))
  fs.writeFileSync(path.join(fixture, 'release-reaper2'), '1')
  const winnerFinished = waitForFile(path.join(fixture, 'reaper2-result'), 3000)
  for (const child of [reaper1, reaper2, ordinary]) {
    try { child.kill() } catch {}
  }

  const crashedThread = 'accepted-boundary-crashed-recovery-coordinator'
  const crashedLock = path.join(lockDirectory, `${crashedThread}.lock`)
  const crashedCoordinator = path.join(lockDirectory, `${crashedThread}.recovery`)
  fs.writeFileSync(crashedLock, JSON.stringify({
    pid: 99999998,
    owner_nonce: 'e'.repeat(64),
    at: staleTime.toISOString(),
    control_plane_id: control.SCV_SINGLE_CONTROL_PLANE_ID
  }) + '\n', { mode: 0o600 })
  fs.utimesSync(crashedLock, staleTime, staleTime)
  fs.writeFileSync(crashedCoordinator, JSON.stringify({
    pid: 99999997,
    owner_nonce: 'f'.repeat(64),
    at: staleTime.toISOString(),
    control_plane_id: control.SCV_SINGLE_CONTROL_PLANE_ID,
    purpose: 'serialized_stale_lock_recovery'
  }) + '\n', { mode: 0o600 })
  let crashedCoordinatorError = ''
  try {
    control.recordIngressEvent(root, {
      contact_id: crashedThread,
      thread_id: crashedThread,
      message_id: `${crashedThread}-message`,
      text: 'hello',
      received_at: new Date(BASE_MS).toISOString()
    }, AUTH)
  } catch (error) { crashedCoordinatorError = String(error?.message || error) }
  const crashedCoordinatorPreserved = fs.existsSync(crashedCoordinator) && fs.existsSync(crashedLock)
  try { fs.unlinkSync(crashedCoordinator) } catch {}
  try { fs.unlinkSync(crashedLock) } catch {}
  fs.rmSync(fixture, { recursive: true, force: true })
  return {
    coordinatorOwned,
    reaper2Blocked,
    gapOpen,
    winnerAcquired,
    reaper1Finished,
    ordinaryFinished,
    winnerFinished,
    replacementSurvived,
    criticalFilesBeforeRelease,
    reaper1Result,
    ordinaryResult,
    crashedCoordinatorError,
    crashedCoordinatorPreserved
  }
}

function runScvAcceptedUnverifiedBoundaryHarness() {
  let checked = 0
  const failures = []
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  try {
    for (const count of [1, 2, 3, 4]) {
      const scenario = makeScenario(`complete-${count}`, count)
      const attempts = scenario.history.events.filter((event) => event.role === 'assistant_attempted')
      check(`complete_${count}_bubble_packet_reconciles`,
        scenario.ingress.accepted_unverified_boundary_reconciled === true &&
        scenario.ingress.accepted_unverified_boundary_bubble_count === count,
        JSON.stringify(scenario.ingress))
      check(`complete_${count}_bubble_history_stays_honest`, attempts.length === count && attempts.every((event) =>
        event.role === 'assistant_attempted' &&
        event.delivery_status === 'manychat_accepted_unverified' &&
        event.accepted_unverified_conversation_boundary?.delivery_confirmed === false &&
        event.accepted_unverified_conversation_boundary?.no_resend === true &&
        isConversationVisibleAssistantEvent(event)
      ), JSON.stringify(attempts))
      check(`complete_${count}_bubble_closes_old_backlog`,
        JSON.stringify(contract.pendingUnansweredUserTurnTexts(scenario.priorHistory)) === '[]')
      check(`complete_${count}_bubble_reconstructs_full_assistant_packet`,
        authority.latestAssistantPacketText(scenario.priorHistory) === scenario.bubbles.map((bubble) => bubble.text).join(' \n '),
        authority.latestAssistantPacketText(scenario.priorHistory))
    }

    const noReceipt = makeScenario('no-receipt', 1, { receipt_count: 0 })
    check('no_delivery_receipt_does_not_close',
      noReceipt.ingress.accepted_unverified_boundary_reconciled === false &&
      contract.pendingUnansweredUserTurnTexts(noReceipt.priorHistory).includes(noReceipt.first.text))

    const failed = makeScenario('failed', 1, {
      delivery_status: 'send_failed',
      receipt_delivery_status: 'send_failed',
      delivery_accepted: false
    })
    check('failed_or_rejected_attempt_does_not_close',
      failed.ingress.accepted_unverified_boundary_reconciled === false &&
      !failed.history.events.some((event) => isConversationVisibleAssistantEvent(event)))

    const partial = makeScenario('partial-two', 2, { receipt_count: 1 })
    check('partial_multi_bubble_receipts_fail_closed', partial.ingress.accepted_unverified_boundary_reconciled === false)

    const duplicate = makeScenario('duplicate-two', 2, { receipt_count: 3, duplicate_receipt: true })
    check('extra_duplicate_receipt_fails_closed', duplicate.ingress.accepted_unverified_boundary_reconciled === false)

    const noncontiguous = makeScenario('noncontiguous-visible-subset', 4, { attempt_indexes: [0, 2] })
    const noncontiguousAttempts = noncontiguous.history.events.filter((event) => event.role === 'assistant_attempted')
    check('noncontiguous_accepted_visible_subset_reconciles_exactly',
      noncontiguous.ingress.accepted_unverified_boundary_reconciled === true &&
      noncontiguous.ingress.accepted_unverified_boundary_bubble_count === 2 &&
      noncontiguousAttempts.length === 2 &&
      noncontiguousAttempts.every((event) =>
        isConversationVisibleAssistantEvent(event) &&
        event.accepted_unverified_conversation_boundary?.packet_bubble_count === 4 &&
        event.accepted_unverified_conversation_boundary?.visible_bubble_count === 2 &&
        JSON.stringify(event.accepted_unverified_conversation_boundary?.visible_bubble_indexes) === '[0,2]'
      ))

    const ambiguous = makeScenario('ambiguous-groups', 1, { ambiguous_attempt_group: true })
    check('multiple_attempt_packet_groups_fail_closed', ambiguous.ingress.accepted_unverified_boundary_reconciled === false)

    const unauthenticated = makeScenario('unauthenticated', 1, { authenticated: false })
    check('unauthenticated_newer_inbound_does_not_close', unauthenticated.ingress.accepted_unverified_boundary_reconciled === false)

    const sameTurn = makeScenario('same-turn', 1, { same_message_id: true })
    check('same_turn_retry_does_not_close', sameTurn.ingress.accepted_unverified_boundary_reconciled === false)

    const notNewer = makeScenario('not-newer', 1, { not_strictly_newer: true })
    check('non_newer_inbound_does_not_close', notNewer.ingress.accepted_unverified_boundary_reconciled === false)

    const missingProviderArtifact = makeScenario('missing-provider-artifact', 1, { provider_artifact: 'missing' })
    check('missing_provider_response_artifact_does_not_close',
      missingProviderArtifact.ingress.accepted_unverified_boundary_reconciled === false)

    const tamperedProviderArtifact = makeScenario('tampered-provider-artifact', 1, { provider_artifact: 'tampered' })
    check('tampered_provider_response_artifact_does_not_close',
      tamperedProviderArtifact.ingress.accepted_unverified_boundary_reconciled === false)

    const crashRecovery = makeScenario('state-history-fault-recovery', 2, { fault_after_state_write: true })
    const crashAttempts = crashRecovery.history.events.filter((event) => event.role === 'assistant_attempted')
    check('state_history_fault_restart_recovers_exactly_once',
      crashRecovery.faultObserved === true &&
      crashRecovery.ingress.accepted_unverified_boundary_reconciled === true &&
      crashAttempts.length === 2 && crashAttempts.every((event) => isConversationVisibleAssistantEvent(event)) &&
      crashRecovery.history.events.filter((event) =>
        event.role === 'user' && event.message_id === crashRecovery.next.message_id
      ).length === 1 &&
      !control.conversationContextPublicationPending(root, crashRecovery.threadId))

    const interleaved = makeInterleavedPacketScenario()
    const interleavedAttempts = interleaved.history.events.filter((event) => event.role === 'assistant_attempted')
    const outboxSource = fs.readFileSync(path.join(__dirname, 'outbox-worker.js'), 'utf8')
    check('newer_inbound_reconciles_only_accepted_visible_subset_and_never_exempts_unsent_stale_bubbles',
      interleaved.ingress.accepted_unverified_boundary_reconciled === true &&
      interleaved.ingress.accepted_unverified_boundary_bubble_count === 1 &&
      interleaved.contextPublicationPending === false &&
      interleavedAttempts.length === 1 && interleavedAttempts.every((event) =>
        isConversationVisibleAssistantEvent(event) &&
        event.accepted_unverified_conversation_boundary?.packet_bubble_count === 3 &&
        event.accepted_unverified_conversation_boundary?.visible_bubble_count === 1
      ) &&
      interleaved.history.events.filter((event) => event.role === 'user' && event.message_id === interleaved.next.message_id).length === 1 &&
      !outboxSource.includes('worker_stale_bypass_accepted_unverified_packet_completion'))

    const coalescenceGap = makePriorUnansweredCoalescenceScenario()
    const coalescenceAttempts = coalescenceGap.history.events.filter((event) =>
      event.role === 'assistant_attempted' && event.message_id === coalescenceGap.prior.message_id
    )
    check('multi_event_turn_marks_only_the_message_id_scoped_reply_visible',
      coalescenceGap.ingress.accepted_unverified_boundary_reconciled === true &&
      coalescenceGap.ingress.accepted_unverified_boundary_bubble_count === 1 &&
      coalescenceGap.ingress.accepted_unverified_boundary_pending === false &&
      !control.conversationContextPublicationPending(root, coalescenceGap.threadId) &&
      coalescenceAttempts.length === 2 &&
      coalescenceAttempts.filter((event) => isConversationVisibleAssistantEvent(event)).length === 1 &&
      coalescenceAttempts.find((event) => isConversationVisibleAssistantEvent(event))?.reply_to_message_id ===
        coalescenceGap.prior.message_id &&
      JSON.stringify(contract.pendingUnansweredUserTurnTexts(coalescenceGap.history.events)) ===
        JSON.stringify([coalescenceGap.unanswered.text, coalescenceGap.observer.text]),
      JSON.stringify({ ingress: coalescenceGap.ingress, history: coalescenceGap.history.events }))

    const multiEventPrice = makeMultiEventPriceAnsweredScenario()
    const answeredPriceAttempt = multiEventPrice.history.events.find((event) =>
      event.role === 'assistant_attempted' && event.message_id === multiEventPrice.price.message_id
    )
    check('multi_event_price_reply_is_visible_and_does_not_rearm_rate_after_form_submission',
      multiEventPrice.ingress.accepted_unverified_boundary_reconciled === true &&
      isConversationVisibleAssistantEvent(answeredPriceAttempt) &&
      answeredPriceAttempt?.reply_to_message_id === multiEventPrice.price.message_id &&
      !contract.pendingUnansweredUserTurnTexts(multiEventPrice.history.events).includes(multiEventPrice.price.text) &&
      contract.pendingUnansweredUserTurnTexts(multiEventPrice.history.events).includes(multiEventPrice.consent.text) &&
      contract.pendingUnansweredUserTurnTexts(multiEventPrice.history.events).includes(multiEventPrice.submitted.text) &&
      !multiEventPrice.plan.obligations.includes('answer_model_rate') &&
      multiEventPrice.plan.action === transition.ACTIONS.POST_FORM_AVAILABILITY,
      JSON.stringify({ ingress: multiEventPrice.ingress, history: multiEventPrice.history.events, plan: multiEventPrice.plan }))

    const acceptedPublicationRace = makePublicationRaceScenario('accepted', true)
    const acceptedRaceAttempts = acceptedPublicationRace.history.events.filter((event) =>
      event.role === 'assistant_attempted'
    )
    check('provider_accepted_before_receipt_publication_holds_then_reconciles_visible_subset',
      acceptedPublicationRace.ingress.accepted_unverified_delivery_publication_pending === true &&
      acceptedPublicationRace.ingress.accepted_unverified_boundary_pending === true &&
      acceptedPublicationRace.blockedDuringPublication === true &&
      acceptedPublicationRace.blockedAfterTerminal === false &&
      acceptedRaceAttempts.length === 1 && isConversationVisibleAssistantEvent(acceptedRaceAttempts[0]) &&
      acceptedPublicationRace.history.events.filter((event) =>
        event.role === 'user' && event.message_id === acceptedPublicationRace.next.message_id
      ).length === 1)

    const failedPublicationRace = makePublicationRaceScenario('failed', false)
    check('provider_failure_clears_publication_hold_without_creating_boundary',
      failedPublicationRace.ingress.accepted_unverified_delivery_publication_pending === true &&
      failedPublicationRace.blockedDuringPublication === true &&
      failedPublicationRace.blockedAfterTerminal === false &&
      !failedPublicationRace.history.events.some((event) => isConversationVisibleAssistantEvent(event)))

    const preNetworkCrash = makePublicationRaceScenario('pre-network-crash', false, true)
    check('pre_network_publication_crash_without_attempt_recovers_and_releases_observer',
      preNetworkCrash.blockedDuringPublication === true &&
      preNetworkCrash.blockedAfterTerminal === false &&
      !control.conversationContextPublicationPending(root, preNetworkCrash.threadId))

    const publicationBeginStaleRace = makePublicationBeginStaleRaceScenario()
    check('publication_begin_atomically_rejects_stale_generation_before_network',
      publicationBeginStaleRace.error === 'delivery_publication_stale_against_latest_ingress' &&
      publicationBeginStaleRace.publicationPending === false &&
      publicationBeginStaleRace.history.events.filter((event) => event.role === 'user').length === 2 &&
      publicationBeginStaleRace.history.events.every((event) => event.role === 'user'),
      JSON.stringify(publicationBeginStaleRace))

    const controlLocks = makeControlLockRecoveryScenarios()
    check('corrupt_stale_control_lock_is_recovered_without_busy_spin',
      controlLocks.corruptRecovered.ok === true)
    check('lock_release_never_unlinks_replacement_owner_nonce', controlLocks.replacementPreserved === true)
    check('live_stale_control_lock_waits_bounded_then_fails_closed',
      /single_control_lock_timeout/.test(controlLocks.liveError) &&
      controlLocks.liveWaitMs >= 4900 && controlLocks.liveWaitMs < 8000 &&
      controlLocks.liveLockPreserved === true,
      JSON.stringify(controlLocks))

    const coordinatorRace = makeControlLockRecoveryCoordinatorRaceScenario()
    check('serialized_stale_reapers_never_unlink_live_replacement_owner',
      coordinatorRace.coordinatorOwned === true &&
        coordinatorRace.reaper2Blocked === true &&
        coordinatorRace.gapOpen === true && coordinatorRace.winnerAcquired === true &&
        coordinatorRace.replacementSurvived === true &&
        JSON.stringify(coordinatorRace.criticalFilesBeforeRelease) === JSON.stringify(['reaper2-critical']) &&
        /single_control_lock_timeout/.test(coordinatorRace.reaper1Result) &&
        /single_control_lock_timeout/.test(coordinatorRace.ordinaryResult) &&
        coordinatorRace.winnerFinished === true,
      JSON.stringify(coordinatorRace))
    check('crashed_recovery_coordinator_fails_closed_for_manual_recovery',
      /single_control_lock_timeout/.test(coordinatorRace.crashedCoordinatorError) &&
        coordinatorRace.crashedCoordinatorPreserved === true,
      JSON.stringify(coordinatorRace))

    for (const count of [1, 2, 3, 4]) {
      const confirmedBefore = makeConfirmedPublicationRaceScenario(count, true)
      const beforeAssistants = confirmedBefore.history.events.filter((event) => event.role === 'assistant')
      const beforeObserverIndex = confirmedBefore.history.events.findIndex((event) =>
        event.role === 'user' && event.message_id === confirmedBefore.observer.message_id
      )
      check(`confirmed_${count}_bubble_response_before_observer_reorders_atomically`,
        confirmedBefore.ingress.accepted_unverified_delivery_publication_pending === true &&
        beforeAssistants.length === count &&
        beforeAssistants.every((event) => confirmedBefore.history.events.indexOf(event) < beforeObserverIndex) &&
        JSON.stringify(contract.pendingUnansweredUserTurnTexts(confirmedBefore.history.events)) === JSON.stringify([confirmedBefore.observer.text]) &&
        !control.conversationContextPublicationPending(root, confirmedBefore.threadId),
        JSON.stringify({ ingress: confirmedBefore.ingress, history: confirmedBefore.history.events, pending: contract.pendingUnansweredUserTurnTexts(confirmedBefore.history.events) }))
    }

    const confirmedAfter = makeConfirmedPublicationRaceScenario(2, false)
    const lateConfirmed = confirmedAfter.history.events.find((event) => event.late_prior_message_delivery === true)
    check('confirmed_response_after_observer_preserves_chronology_without_closing_observer',
      Boolean(lateConfirmed) &&
      confirmedAfter.history.events.indexOf(lateConfirmed) > confirmedAfter.history.events.findIndex((event) =>
        event.role === 'user' && event.message_id === confirmedAfter.observer.message_id
      ) &&
      JSON.stringify(contract.pendingUnansweredUserTurnTexts(confirmedAfter.history.events)) === JSON.stringify([confirmedAfter.observer.text]) &&
      !control.conversationContextPublicationPending(root, confirmedAfter.threadId),
      JSON.stringify({ history: confirmedAfter.history.events, pending: contract.pendingUnansweredUserTurnTexts(confirmedAfter.history.events) }))
    check('late_reply_to_prior_message_never_closes_newer_user_turn',
      JSON.stringify(contract.pendingUnansweredUserTurnTexts([
        { role: 'user', message_id: 'late-a', text: 'question A' },
        { role: 'user', message_id: 'late-b', text: 'question B' },
        { role: 'assistant', message_id: 'late-a', reply_to_message_id: 'late-a', text: 'answer A', late_prior_message_delivery: true }
      ])) === JSON.stringify(['question B']))

    for (const count of [2, 3, 4]) {
      for (const finalAcceptedUnverified of [true, false]) {
        const mixed = makeMixedPublicationRaceScenario(count, finalAcceptedUnverified)
        const observerIndex = mixed.history.events.findIndex((event) =>
          event.role === 'user' && event.message_id === mixed.observer.message_id
        )
        const packetEvents = mixed.history.events.filter((event) => event.message_id === mixed.first.message_id && event.role !== 'user')
        const attempted = packetEvents.filter((event) => event.role === 'assistant_attempted')
        check(`mixed_${count}_bubble_${finalAcceptedUnverified ? 'accepted' : 'confirmed'}_final_reconciles_atomic_union`,
          mixed.ingress.accepted_unverified_delivery_publication_pending === true &&
          packetEvents.length === count && packetEvents.every((event) => mixed.history.events.indexOf(event) < observerIndex) &&
          attempted.length === 1 && attempted.every((event) => isConversationVisibleAssistantEvent(event)) &&
          JSON.stringify(contract.pendingUnansweredUserTurnTexts(mixed.history.events)) === JSON.stringify([mixed.observer.text]) &&
          !control.conversationContextPublicationPending(root, mixed.threadId),
          JSON.stringify(mixed.history.events))
      }
    }

    for (const count of [2, 3, 4]) {
      for (const acceptedFirst of [true, false]) {
        for (let deliveredCount = 2; deliveredCount <= count; deliveredCount += 1) {
          const direct = makeMixedDirectCutScenario(count, acceptedFirst, deliveredCount)
          const packetEvents = direct.history.events.filter((event) =>
            event.message_id === direct.first.message_id && event.role !== 'user'
          )
          const attempted = packetEvents.filter((event) => event.role === 'assistant_attempted')
          check(`direct_mixed_${count}_${deliveredCount}_${acceptedFirst ? 'accepted_first' : 'confirmed_first'}_marks_exact_union`,
            direct.ingress.accepted_unverified_boundary_reconciled === true &&
              packetEvents.length === deliveredCount &&
              attempted.length >= 1 && attempted.every((event) => isConversationVisibleAssistantEvent(event)) &&
              !packetEvents.some((event) => Number(event.bubble_index) >= deliveredCount) &&
              JSON.stringify(contract.pendingUnansweredUserTurnTexts(direct.history.events)) === JSON.stringify([direct.observer.text]),
            JSON.stringify(direct.history.events))
        }
      }
    }

    const lateDistinctC = makeLateAcceptedCorrelationScenario('distinct-c')
    const lateBIndex = lateDistinctC.history.events.findIndex((event) =>
      event.role === 'user' && event.message_id === lateDistinctC.observerB.message_id
    )
    const lateAttemptIndex = lateDistinctC.history.events.indexOf(lateDistinctC.attempt)
    const lateCIndex = lateDistinctC.history.events.findIndex((event) =>
      event.role === 'user' && event.message_id === lateDistinctC.trigger.message_id
    )
    check('late_accepted_delivery_remains_bound_to_a_until_distinct_authenticated_c',
      lateDistinctC.ingress.accepted_unverified_boundary_reconciled === true &&
        isConversationVisibleAssistantEvent(lateDistinctC.attempt) &&
        lateDistinctC.attempt?.accepted_unverified_conversation_boundary?.observed_by_message_id === lateDistinctC.trigger.message_id &&
        lateDistinctC.attempt?.reply_to_message_id === lateDistinctC.first.message_id &&
        lateDistinctC.attempt?.late_prior_message_delivery === true &&
        lateBIndex < lateAttemptIndex && lateAttemptIndex < lateCIndex &&
        JSON.stringify(contract.pendingUnansweredUserTurnTexts(lateDistinctC.history.events)) ===
          JSON.stringify([lateDistinctC.observerB.text, lateDistinctC.trigger.text]) &&
        !control.conversationContextPublicationPending(root, lateDistinctC.threadId),
      JSON.stringify(lateDistinctC.history.events))

    const lateIntervening = makeLateAcceptedCorrelationScenario('authenticated-intervening', {
      ambiguous_intervening: true
    })
    check('late_accepted_delivery_crosses_authenticated_multi_event_turn_without_misattribution',
      lateIntervening.ingress.accepted_unverified_boundary_reconciled === true &&
        isConversationVisibleAssistantEvent(lateIntervening.attempt) &&
        lateIntervening.attempt?.accepted_unverified_conversation_boundary?.observed_by_message_id ===
          lateIntervening.trigger.message_id &&
        lateIntervening.attempt?.reply_to_message_id === lateIntervening.first.message_id &&
        JSON.stringify(contract.pendingUnansweredUserTurnTexts(lateIntervening.history.events)) ===
          JSON.stringify([
            lateIntervening.observerB.text,
            'also maybe on my forearm',
            lateIntervening.trigger.text
          ]),
      JSON.stringify({ ingress: lateIntervening.ingress, history: lateIntervening.history.events }))

    for (const [name, variant] of [
      ['duplicate-b', { duplicate_b: true }],
      ['unauthenticated-c', { unauthenticated_c: true }],
      ['equal-response-time', { equal_response_time: true }]
    ]) {
      const rejected = makeLateAcceptedCorrelationScenario(name, variant)
      check(`late_accepted_${name}_fails_closed_without_misattribution`,
        !isConversationVisibleAssistantEvent(rejected.attempt) &&
          rejected.attempt?.reply_to_message_id !== rejected.observerB.message_id &&
          contract.pendingUnansweredUserTurnTexts(rejected.history.events).includes(rejected.first.text) &&
          contract.pendingUnansweredUserTurnTexts(rejected.history.events).includes(rejected.observerB.text),
        JSON.stringify({ ingress: rejected.ingress, history: rejected.history.events }))
    }

    for (const count of [2, 4]) {
      for (const faultPoint of [
        'after_receipt',
        'before_history_write',
        'after_history_write',
        'after_publication_clear',
        'after_pending_clear'
      ]) {
        const crash = makeAtomicMixedConfirmedCrashScenario(count, faultPoint)
        const packetEvents = crash.history.events.filter((event) =>
          event.message_id === crash.first.message_id && event.role !== 'user'
        )
        const attempted = packetEvents.filter((event) => event.role === 'assistant_attempted')
        const observerIndex = crash.history.events.findIndex((event) =>
          event.role === 'user' && event.message_id === crash.observer.message_id
        )
        const expectedFirstWrites = ['after_receipt', 'before_history_write'].includes(faultPoint) ? 0 : 1
        check(`atomic_mixed_${count}_${faultPoint}_recovers_without_split_or_duplicate`,
          crash.faultObserved === true &&
            crash.firstCallHistoryWrites === expectedFirstWrites &&
            crash.receiptWrites === 1 && crash.receipts.length === count &&
            packetEvents.length === count &&
            new Set(packetEvents.map((event) => Number(event.bubble_index))).size === count &&
            attempted.length === count - 1 && attempted.every((event) => isConversationVisibleAssistantEvent(event)) &&
            packetEvents.every((event) => crash.history.events.indexOf(event) < observerIndex) &&
            JSON.stringify(contract.pendingUnansweredUserTurnTexts(crash.history.events)) === JSON.stringify([crash.observer.text]) &&
            !control.conversationContextPublicationPending(root, crash.threadId),
          JSON.stringify({ history: crash.history.events, receipts: crash.receipts, writes: crash.firstCallHistoryWrites }))
      }
    }

    const endToEnd = makeScenario('two-turn-offer-form', 2)
    const projected = authority.loadRecentThreadHistory(endToEnd.next, 30)
    const assistantContext = authority.latestAssistantPacketText(projected)
    const plan = transition.deriveClosedTransitionPlan({
      ...endToEnd.next,
      message: endToEnd.next.text,
      live_message: endToEnd.next.text,
      recent_history: projected,
      structured_state: {}
    })
    check('two_turn_projected_history_preserves_reconciled_assistant_context',
      assistantContext === endToEnd.bubbles.map((bubble) => bubble.text).join(' \n '), assistantContext)
    check('two_turn_design_moves_to_offer_form_without_stale_price_obligation',
      plan.action === transition.ACTIONS.OFFER_FORM &&
      !plan.obligations.includes('answer_model_rate'), JSON.stringify(plan))
    check('unreconciled_attempt_is_adjacency_barrier_against_older_direct_question',
      transition.latestAssistantPacketText({
        message_id: 'boundary-adjacency-live',
        recent_history: [
          { role: 'assistant', message_id: 'older-question', text: 'what dates work for you?' },
          { role: 'user', message_id: 'boundary-adjacency-prior', text: '23' },
          {
            role: 'assistant_attempted',
            message_id: 'boundary-adjacency-prior',
            bubble_index: 0,
            text: 'does the 23rd work?',
            delivery_status: 'send_failed'
          },
          { role: 'user', message_id: 'boundary-adjacency-live', text: 'I want a raven design' }
        ]
      }) === '')
    check('boundary_reconciliation_never_creates_outbox_work',
      !fs.existsSync(path.join(root, 'outbox')) || fs.readdirSync(path.join(root, 'outbox')).length === 0)

    if (failures.length) throw new Error(JSON.stringify(failures, null, 2))
    return { ok: true, checked }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(runScvAcceptedUnverifiedBoundaryHarness(), null, 2) + '\n')
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2) + '\n')
    process.exit(1)
  }
}

module.exports = { runScvAcceptedUnverifiedBoundaryHarness }
