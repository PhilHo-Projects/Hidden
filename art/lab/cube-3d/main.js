import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/*
 * A cube you turn a quarter at a time and paint by clicking.
 *
 * The camera never moves. It stares at whichever face is in front, like an
 * editor locked to an axis view, and every turn is the *cube* rotating 90° about
 * a screen axis. Cells can only be painted once a turn has fully landed.
 *
 * The model comes from blender/build_cube.py. Each tile carries the game's own
 * `face`, `cell` and `location`, so a click here names the same location ID the
 * web client would.
 */

// ── tuning ──────────────────────────────────────────────────────────────────

const TURN_MS = 340
const TURN_OVERSHOOT = 1.15   // 0 for a dead stop, ~1.7 for a big bounce
const PAINT_MS = 200
const PRESS_MS = 170
const PRESS_DEPTH = 0.025
const FACE_FILL = 0.58        // share of the shorter screen side the front face covers
const FOV = 26

const PALETTE = [
  { name: 'rock', hex: '#6EDC3C' },
  { name: 'paper', hex: '#4C6EF5' },
  { name: 'scissors', hex: '#DC2626' },
]

// ── the cube's own geometry, in cube-local space ────────────────────────────

const v = (x, y, z) => new THREE.Vector3(x, y, z)

// Outward normal, and the face's own "north" in the frame CUBE_ADJACENCY uses.
const FACES = {
  home: { normal: v(0, 0, 1), north: v(0, 1, 0), label: 'HOME' },
  up: { normal: v(0, 1, 0), north: v(0, 0, -1), label: 'UP' },
  down: { normal: v(0, -1, 0), north: v(0, 0, 1), label: 'DOWN' },
  left: { normal: v(-1, 0, 0), north: v(0, 1, 0), label: 'LEFT' },
  right: { normal: v(1, 0, 0), north: v(0, 1, 0), label: 'RIGHT' },
  back: { normal: v(0, 0, -1), north: v(0, 1, 0), label: 'BACK' },
}

// Screen-space quarter turns. The camera is fixed, so world axes are screen axes.
const X = v(1, 0, 0)
const Y = v(0, 1, 0)
const Z = v(0, 0, 1)
const TURNS = {
  north: { axis: X, degrees: 90 },   // the top face comes to the front
  south: { axis: X, degrees: -90 },
  east: { axis: Y, degrees: -90 },   // the right face comes to the front
  west: { axis: Y, degrees: 90 },
  ccw: { axis: Z, degrees: 90 },
  cw: { axis: Z, degrees: -90 },
}

const KEY_TURNS = {
  ArrowUp: 'north', w: 'north',
  ArrowDown: 'south', s: 'south',
  ArrowRight: 'east', d: 'east',
  ArrowLeft: 'west', a: 'west',
  q: 'ccw', e: 'cw',
}

// ── DOM ─────────────────────────────────────────────────────────────────────

const stage = document.querySelector('#stage')
const canvas = document.querySelector('#scene')
const statusEl = document.querySelector('#status')
const frontFaceEl = document.querySelector('#front-face')
const frontRollEl = document.querySelector('#front-roll')
const readoutEl = document.querySelector('#readout')
const swatchesEl = document.querySelector('#swatches')
const cameraToggle = document.querySelector('#camera-toggle')

// ── renderer, lights, cameras ───────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.toneMapping = THREE.NeutralToneMapping

const scene = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.5

// Lights are fixed to the view, so the face in front is always lit the same way
// and the faces swinging in and out pass through the light as they turn.
const key = new THREE.DirectionalLight(0xffffff, 2.4)
key.position.set(-2.5, 3.5, 5)
const fill = new THREE.DirectionalLight(0xffe6a0, 0.5)
fill.position.set(3, -2.5, 3)
scene.add(key, fill)

const perspective = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
ortho.position.z = 10
let camera = perspective

const cube = new THREE.Group()
scene.add(cube)

// ── render on demand ────────────────────────────────────────────────────────
// Nothing draws while the cube sits still. A frame is requested by whatever
// changed, and the loop keeps itself alive only while a tween is running.

const tweens = new Set()
let frameRequested = false

function invalidate() {
  if (frameRequested) return
  frameRequested = true
  requestAnimationFrame(frame)
}

function frame(now) {
  frameRequested = false
  for (const t of tweens) {
    const k = Math.min(1, Math.max(0, (now - t.start) / t.duration))
    t.update(k)
    if (k === 1) {
      tweens.delete(t)
      t.done?.()
    }
  }
  renderer.render(scene, camera)
  if (tweens.size) invalidate()
}

function tween(duration, update, done) {
  tweens.add({ start: performance.now(), duration, update, done })
  invalidate()
}

const easeOutCubic = (k) => 1 - (1 - k) ** 3
function easeOutBack(k) {
  const c1 = TURN_OVERSHOOT
  const c3 = c1 + 1
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2
}

// ── layout ──────────────────────────────────────────────────────────────────

function layout() {
  const width = stage.clientWidth
  const height = stage.clientHeight
  const aspect = width / height
  renderer.setSize(width, height, false)

  // How much of the world is visible across the screen's height, chosen so the
  // two-unit face covers FACE_FILL of the shorter side.
  const visibleHeight = 2 / FACE_FILL / Math.min(1, aspect)

  perspective.aspect = aspect
  perspective.position.z = 1 + visibleHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
  perspective.updateProjectionMatrix()

  ortho.top = visibleHeight / 2
  ortho.bottom = -visibleHeight / 2
  ortho.left = (-visibleHeight * aspect) / 2
  ortho.right = (visibleHeight * aspect) / 2
  ortho.updateProjectionMatrix()

  stage.style.setProperty('--face', `${FACE_FILL * Math.min(width, height)}px`)
  invalidate()
}

new ResizeObserver(layout).observe(stage)

// ── state ───────────────────────────────────────────────────────────────────

let ready = false
let turning = false
let queuedTurn = null
let hitTargets = []
let hovered = null
let lastPointer = null
let selected = 0
const tiles = []

// ── turning ─────────────────────────────────────────────────────────────────

/**
 * Round a rotation to the nearest exact quarter-turn orientation, so a hundred
 * turns in a row still land perfectly square instead of drifting.
 */
function snap(quaternion) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(quaternion)
  const e = m.elements
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) e[i] = Math.round(e[i])
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

function turn(name) {
  if (!ready) return
  if (turning) {
    // One turn of look-ahead, so a quick double tap does not get swallowed.
    queuedTurn = name
    return
  }
  const { axis, degrees } = TURNS[name]
  const delta = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees))
  rotateTo(snap(delta.multiply(cube.quaternion)))
}

function rotateTo(target) {
  const from = cube.quaternion.clone()
  turning = true
  setHovered(null)
  tween(
    TURN_MS,
    (k) => cube.quaternion.slerpQuaternions(from, target, easeOutBack(k)),
    () => {
      cube.quaternion.copy(target)
      turning = false
      updateFacing()
      if (lastPointer) setHovered(pick(lastPointer.x, lastPointer.y))
      if (queuedTurn) {
        const next = queuedTurn
        queuedTurn = null
        turn(next)
      }
    },
  )
}

function reset() {
  if (!ready || turning) return
  queuedTurn = null
  rotateTo(new THREE.Quaternion())
}

// ── reading the cube ────────────────────────────────────────────────────────

const scratch = new THREE.Vector3()

function worldOf(local) {
  return scratch.copy(local).applyQuaternion(cube.quaternion)
}

function faceTowards(axis) {
  return Object.keys(FACES).find((face) => worldOf(FACES[face].normal).dot(axis) > 0.99)
}

function updateFacing() {
  const front = faceTowards(Z)
  const top = faceTowards(Y)
  frontFaceEl.textContent = FACES[front].label

  // Where the front face's own north points on screen. "Upright" means the face
  // is drawn in the same frame CUBE_ADJACENCY assumes; anything else is the
  // 24-orientations problem, made visible.
  const north = worldOf(FACES[front].north)
  const roll =
    north.y > 0.99 ? 'upright'
    : north.y < -0.99 ? 'upside down'
    : north.x > 0.99 ? 'rolled 90° ↻'
    : 'rolled 90° ↺'
  frontRollEl.textContent = `${roll} · top: ${FACES[top].label}`
  frontRollEl.classList.toggle('rolled', roll !== 'upright')
}

// ── picking ─────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

/** The front-face tile under a screen point, or null. Never answers mid-turn. */
function pick(clientX, clientY) {
  if (!ready || turning) return null
  const rect = canvas.getBoundingClientRect()
  pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
  // World matrices are otherwise only refreshed by a render. Without this, a
  // pick in the same tick as a turn landing, a resize, or a camera switch reads
  // last frame's cube -- or, for a camera never drawn yet, one sitting at the
  // origin.
  scene.updateMatrixWorld()
  camera.updateMatrixWorld()
  raycaster.setFromCamera(pointer, camera)
  // The body is in the list so a ray through a grout line stops there instead
  // of carrying on to a tile behind it.
  const hit = raycaster.intersectObjects(hitTargets, false)[0]
  const tile = hit?.object.userData.face ? hit.object : null
  if (!tile) return null
  return worldOf(FACES[tile.userData.face].normal).z > 0.99 ? tile : null
}

function setHovered(tile) {
  if (tile === hovered) return
  if (hovered) hovered.material.emissive.setHex(0x000000)
  hovered = tile
  if (hovered) {
    hovered.material.emissive.set('#d7af13')
    hovered.material.emissiveIntensity = 0.14
  }
  canvas.classList.toggle('can-paint', Boolean(hovered))
  invalidate()
}

// ── painting ────────────────────────────────────────────────────────────────

function paint(tile) {
  const { userData } = tile
  userData.paint = userData.paint === selected ? null : selected

  const from = tile.material.color.clone()
  const to = userData.paint === null ? userData.base : new THREE.Color(PALETTE[userData.paint].hex)
  tween(PAINT_MS, (k) => tile.material.color.lerpColors(from, to, easeOutCubic(k)))

  const inward = FACES[userData.face].normal
  tween(PRESS_MS, (k) => {
    tile.position.copy(userData.rest).addScaledVector(inward, -Math.sin(k * Math.PI) * PRESS_DEPTH)
  })

  const what = userData.paint === null ? 'cleared' : PALETTE[userData.paint].name
  readoutEl.textContent =
    `${FACES[userData.face].label} · cell ${userData.cell} · location ${userData.location} → ${what}`
}

function clearAll() {
  for (const tile of tiles) {
    if (tile.userData.paint === null) continue
    tile.userData.paint = null
    const from = tile.material.color.clone()
    tween(PAINT_MS, (k) => tile.material.color.lerpColors(from, tile.userData.base, easeOutCubic(k)))
  }
  readoutEl.textContent = 'Cleared.'
}

// ── controls ────────────────────────────────────────────────────────────────

function selectColour(index) {
  selected = index
  for (const button of swatchesEl.children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.index) === index))
  }
}

PALETTE.forEach(({ name, hex }, index) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'swatch'
  button.dataset.index = String(index)
  button.style.setProperty('--color', hex)
  button.textContent = String(index + 1)
  button.setAttribute('aria-label', `Paint ${name}`)
  button.addEventListener('click', () => selectColour(index))
  swatchesEl.append(button)
})
selectColour(0)

function toggleCamera() {
  camera = camera === perspective ? ortho : perspective
  cameraToggle.textContent = camera === perspective ? 'Perspective' : 'Orthographic'
  if (lastPointer) setHovered(pick(lastPointer.x, lastPointer.y))
  invalidate()
}

for (const button of document.querySelectorAll('[data-turn]')) {
  button.addEventListener('click', () => turn(button.dataset.turn))
}
document.querySelector('#reset').addEventListener('click', reset)
document.querySelector('#clear').addEventListener('click', clearAll)
cameraToggle.addEventListener('click', toggleCamera)

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const turnName = KEY_TURNS[key]
  if (turnName) {
    event.preventDefault()
    turn(turnName)
    return
  }
  if (key >= '1' && key <= String(PALETTE.length)) selectColour(Number(key) - 1)
  else if (key === 'p') toggleCamera()
  else if (key === 'r') reset()
  else if (key === 'c') clearAll()
})

canvas.addEventListener('pointermove', (event) => {
  lastPointer = { x: event.clientX, y: event.clientY }
  setHovered(pick(event.clientX, event.clientY))
})
canvas.addEventListener('pointerleave', () => {
  lastPointer = null
  setHovered(null)
})
canvas.addEventListener('click', (event) => {
  const tile = pick(event.clientX, event.clientY)
  if (tile) paint(tile)
})

// ── load ────────────────────────────────────────────────────────────────────

new GLTFLoader().load(
  '/game/models/cube.glb',
  (gltf) => {
    let body = null
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return
      if (object.userData.role === 'body') body = object
      if (!object.userData.face) return
      // The .glb shares one material across all 54 tiles; each needs its own
      // to be painted on its own.
      object.material = object.material.clone()
      object.userData.base = object.material.color.clone()
      object.userData.rest = object.position.clone()
      object.userData.paint = null
      tiles.push(object)
    })
    cube.add(gltf.scene)
    hitTargets = [body, ...tiles]
    ready = true
    statusEl.textContent = ''
    updateFacing()
    invalidate()
  },
  undefined,
  (error) => {
    statusEl.textContent = `Could not load /game/models/cube.glb — ${error.message ?? error}`
    statusEl.classList.add('error')
  },
)
