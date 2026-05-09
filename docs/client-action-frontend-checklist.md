# Client Action Frontend Checklist

This checklist tracks what the userspace/Electron runtime must guarantee for
the Controller ↔ Frontend Client Action contract.

## Authoritative Action Sources

- [x] Execute only backend-issued action envelopes with `action_id`.
- [x] Accept action envelopes from `/client/actions/pending`.
- [x] Accept SSE `conversation.action_dispatch` envelopes with `action_id`.
- [x] Do not execute `conversation.done.text` fenced action/json blocks.
- [x] Do not execute `assistant_done.content` fenced action/json blocks.
- [x] Do not create or execute `embedded_...` action ids.
- [x] Do not convert `web_search` into browser tabs locally.
- [x] Display a clear warning when action-like text arrives without queue dispatch.

## Runtime Context Sent To Controller

- [x] `X-Client-Platform`
- [x] `X-Client-Shell`
- [x] `X-Client-Browser`
- [x] `X-Client-Timezone`
- [x] `X-Client-Calendar-Provider`
- [x] `X-Client-Capabilities`
- [x] `X-Client-Applications`
- [x] `X-Client-Terminal-Enabled`
- [x] `X-Client-Terminal-Allowed-Commands`
- [x] `X-Client-Terminal-Cwd-Allowlist`

Controller should persist these per user/client and use them when compiling
actions.

## Current Action Coverage

- [x] `browser/open`
- [x] `browser/navigate`
- [x] `browser/search`
- [x] `open_url`
- [x] `app_control/open`
- [x] `app_control/activate`
- [x] `app_control/close`
- [x] `app_control/new_file`
- [x] `app_control/new_tab`
- [x] `browser_control/back`
- [x] `browser_control/forward`
- [x] `browser_control/reload`
- [x] `browser_control/select_result`
- [x] `browser_control/extract_dom`
- [x] `browser_control/click_element`
- [x] `browser_control/type_element`
- [x] `keyboard_type`
- [x] `hotkey`
- [x] `terminal/execute`
- [ ] `browser_control/new_tab`
- [ ] `browser_control/new_window`
- [x] `browser_control/search` via `browser/search`
- [ ] `browser_control/focus_address_bar`
- [ ] stable `mouse_click`
- [ ] stable `mouse_drag`
- [ ] screenshot output persistence policy

## Safety And Sequencing

- [x] Unknown action type/command is not guessed.
- [x] Userspace does not parse natural language intent into actions.
- [x] Capability profile is sent to Controller in headers and request body.
- [x] Same `request_id` follow-up actions are rejected after an earlier failure.
- [x] Input is locked while conversation/action work is busy.
- [x] External app/browser actions can minimize userspace and bring target app forward.
- [x] `terminal` remains policy gated.
- [x] `file_write` remains path-policy gated.
- [x] Mouse actions remain policy gated.
- [ ] macOS Accessibility permission diagnostics for `keyboard_type`/`hotkey`.
- [ ] Settings UI copy for physical input policy and permission requirements.

## Backend Contract Expectations

- [ ] Direct actions must be queued with `action_dispatcher.enqueue(...)`.
- [ ] Controller must not pass assistant text action blocks through to userspace.
- [ ] URL/web/search/map requests should compile to `open_url`.
- [ ] Current-page link/input requests should use `browser_control/extract_dom`
      followed by `click_element` or `type_element`.
- [ ] App requests should target concrete app names from stored runtime context.
- [ ] App aliases such as `sublime_text` should be normalized by Controller using
      the stored app inventory.
- [ ] Browser commands should use `browser_control/*`, not abstract
      `app_control/open target=browser`.
- [ ] Terminal commands should use `terminal/execute` and respect client policy
      headers.

## Realtime Performance Requirements

- [x] Runtime sends context up front so fast intent can avoid deep reasoning.
- [x] Userspace shows processing/thinking immediately.
- [x] Token delta logs are suppressed locally.
- [x] Action progress is shown through action feed/subtitle.
- [ ] Controller fast intent timeout budget should be short and independent from
      deep response generation.
- [ ] Direct action turns should skip assistant text generation.
- [ ] Long-running actions should stream progress without blocking STT/UI.
