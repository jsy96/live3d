// Phase 4 interface: the pet roams between devices (PC <-> phone) over LAN.
//
// Planned architecture:
//   - The desktop Electron app starts a small HTTP + WebSocket service (main
//     process, Phase 4) serving this same renderer bundle plus the .vrm model.
//   - The phone opens `http://<pc-ip>:<port>` (QR code shown from the tray menu)
//     and the pet renders in the browser with the same Pointer-Events code —
//     src/interaction/mouse.js already works for touch.
//   - "Roaming" = a hand-off of pet state over WebSocket: the old device plays
//     an exit animation (pet runs off the screen edge), the new device plays an
//     enter animation (runs in from the opposite edge).
//   - Pet state: { modelId, mood, position, currentState, lastDevice }.

export const ROAMING_EVENTS = Object.freeze({
  HELLO: 'hello', // device announcing itself on the LAN
  PET_TRANSFER: 'pet:transfer', // full pet state hand-off
  PET_STATE: 'pet:state', // periodic mood/position sync while roaming
  PET_EXIT: 'pet:exit', // play exit animation on the source device
  PET_ENTER: 'pet:enter', // play enter animation on the target device
});

export class RoamingHost {
  /** Start the LAN server (Electron main process). Phase 4. */
  async start() {
    throw new Error('RoamingHost: 局域网服务与扫码配对在第四期实现');
  }

  stop() {}

  /** URL the phone should open, null when not running. */
  get lanUrl() {
    return null;
  }
}

export class RoamingClient {
  /** Connect to a desktop host from a phone browser. Phase 4. */
  async connect(_url) {
    throw new Error('RoamingClient: 手机网页端接入在第四期实现');
  }

  send(_event, _payload) {}

  close() {}
}
