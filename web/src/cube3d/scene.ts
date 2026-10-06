import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Euler,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Intersection,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CUBE_FACES, type CubeFace } from '@hidden/game-core'
import { loadCubeModel, loadShieldTexture } from './model'
import { FACE_NORMALS, FACE_NORTHS, type Orientation, type Vec3 } from './orientation'
import { sameTileVisual, type TileVisual } from './tileVisuals'

/*
 * The 3D cube: a port of `art/lab/cube-3d/main.js`, which is where each of the
 * choices below was tried first.
 *
 * The camera never moves. Every turn is the cube rotating under a fixed view,
 * and a pick only answers once a turn has fully landed. Nothing draws while
 * the cube sits still: a frame is requested by whatever changed, and the loop
 * keeps itself alive only while a tween runs.
 */

const TURN_MS = 340
const TURN_OVERSHOOT = 1.15
const PAINT_MS = 200
const PRESS_MS = 170
const PRESS_DEPTH = 0.025
/** Matches the lifetime `useDestructionEffects` gives an effect. */
const LOSS_MS = 620
const LOSS_DEPTH = 0.05
const FOV = 26
/** From a tile's centre to just above its top. Tied to TILE_THICK in build_cube.py. */
const TILE_SURFACE = 0.04
const SHIELD_SIZE = 0.3
const HATCH_SIZE = 0.46
/** Pointer travel under this, in CSS pixels, is a tap rather than a drag. */
const TAP_SLOP = 6
const DRAG_RADIANS_PER_PIXEL = 0.012

const HOVER_EMISSIVE = new Color('#d7af13')
const LOSS_EMISSIVE = new Color('#ff2d2d')
const NO_EMISSIVE = new Color('#000000')

export type CubeSceneMode = 'board' | 'mini'

export interface CubeSceneOptions {
  readonly mode: CubeSceneMode
  /** Share of the canvas's shorter side the front face covers when square to the camera. */
  readonly faceFraction: number
  /**
   * Board mode reads the pointer here rather than on the canvas. The canvas
   * overhangs the board so a turning cube is not clipped, and only a click on
   * the board's own square is a click on the front face.
   */
  readonly pointerTarget?: HTMLElement
  readonly onPick?: (locationId: number) => void
  readonly onFacePick?: (face: CubeFace) => void
  readonly onContextLost?: () => void
}

type TileMesh = Mesh<BufferGeometry, MeshStandardMaterial>

interface Tile {
  readonly mesh: TileMesh
  readonly face: CubeFace
  readonly location: number
  /** Where the tile sits when nothing presses it, in the cube's frame. */
  readonly rest: Vector3
  readonly normal: Vector3
  visual: TileVisual | null
  shield: Mesh | null
  hatch: Mesh | null
}

interface Tween {
  readonly start: number
  readonly duration: number
  readonly update: (k: number) => void
  readonly done?: () => void
  cancelled: boolean
}

const vec = (v: Vec3) => new Vector3(v[0], v[1], v[2])
const easeOutCubic = (k: number) => 1 - (1 - k) ** 3
function easeOutBack(k: number) {
  const c3 = TURN_OVERSHOOT + 1
  return 1 + c3 * (k - 1) ** 3 + TURN_OVERSHOOT * (k - 1) ** 2
}

/** A face's own frame: east, north, outward. Columns of the returned matrix. */
function faceBasis(face: CubeFace): Matrix4 {
  const normal = vec(FACE_NORMALS[face])
  const north = vec(FACE_NORTHS[face])
  return new Matrix4().makeBasis(new Vector3().crossVectors(north, normal), north, normal)
}

function quaternionOf(o: Orientation): Quaternion {
  const matrix = new Matrix4().set(
    o[0], o[1], o[2], 0,
    o[3], o[4], o[5], 0,
    o[6], o[7], o[8], 0,
    0, 0, 0, 1,
  )
  return new Quaternion().setFromRotationMatrix(matrix)
}

function nearestFace(normal: Vector3): CubeFace {
  let best: CubeFace = 'home'
  let bestDot = -Infinity
  for (const face of CUBE_FACES) {
    const alignment = normal.dot(vec(FACE_NORMALS[face]))
    if (alignment > bestDot) {
      bestDot = alignment
      best = face
    }
  }
  return best
}

export class CubeScene {
  private readonly canvas: HTMLCanvasElement
  private readonly options: CubeSceneOptions
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 100)
  private readonly cube = new Group()
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  /*
   * A fixed angle the mini cube is looked at from, composed on top of whatever
   * orientation it is mirroring. Without it, following the main cube exactly
   * would present the same single face square-on and the preview would stop
   * reading as a cube at all. Identity for the board, which is square-on by
   * design.
   */
  private readonly viewTilt = new Quaternion()
  private readonly tiles: Tile[] = []
  private readonly byLocation = new Map<number, Tile>()
  private readonly byMesh = new Map<Object3D, Tile>()
  private readonly hitTargets: Object3D[] = []
  private readonly tweens = new Set<Tween>()
  private readonly owned: { dispose(): void }[] = []
  private readonly overlayMaterials = new Set<MeshBasicMaterial>()
  private readonly cleanups: (() => void)[] = []
  private readonly shieldGeometry = new PlaneGeometry(SHIELD_SIZE, SHIELD_SIZE)
  private readonly hatchGeometry = new PlaneGeometry(HATCH_SIZE, HATCH_SIZE)
  private shieldTexture: Texture | null = null
  private hatchTexture: CanvasTexture | null = null
  private highlight: Mesh | null = null
  private turnTween: Tween | null = null
  private oriented = false
  private painted = false
  private interactive = false
  private hovered: Tile | null = null
  private lastPointer: { x: number; y: number } | null = null
  private drag: { x: number; y: number; travel: number } | null = null
  private frameRequested = false
  private frameHandle = 0
  private disposed = false

  /** Rejects if WebGL is unavailable or the model will not load. */
  static async create(canvas: HTMLCanvasElement, options: CubeSceneOptions): Promise<CubeScene> {
    const scene = new CubeScene(canvas, options)
    try {
      const [gltf, shield] = await Promise.all([loadCubeModel(), loadShieldTexture()])
      scene.install(gltf.scene, shield)
      return scene
    } catch (error) {
      scene.dispose()
      throw error
    }
  }

  private constructor(canvas: HTMLCanvasElement, options: CubeSceneOptions) {
    this.canvas = canvas
    this.options = options
    // Throws when there is no WebGL; `create` turns that into a rejection.
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = NeutralToneMapping

    const pmrem = new PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    const environment = pmrem.fromScene(room, 0.04)
    room.dispose()
    pmrem.dispose()
    this.scene.environment = environment.texture
    this.scene.environmentIntensity = 0.5
    this.owned.push(environment, this.shieldGeometry, this.hatchGeometry)

    // Lights are fixed to the view, so the face in front is always lit the
    // same way and the faces swinging past pass through the light.
    const key = new DirectionalLight(0xffffff, 2.4)
    key.position.set(-2.5, 3.5, 5)
    const fill = new DirectionalLight(0xffe6a0, 0.5)
    fill.position.set(3, -2.5, 3)
    this.scene.add(key, fill, this.cube)

    this.listen(canvas, 'webglcontextlost', (event) => {
      event.preventDefault()
      this.options.onContextLost?.()
    })

    if (options.mode === 'board') this.listenForPlacement(options.pointerTarget ?? canvas)
    else this.listenForSpin(canvas)
  }

  // ── public ────────────────────────────────────────────────────────────────

  setOrientation(orientation: Orientation): void {
    const target = quaternionOf(orientation).premultiply(this.viewTilt)
    if (this.turnTween) {
      this.turnTween.cancelled = true
      this.turnTween = null
    }
    // The first orientation is where the cube starts, not a turn.
    if (!this.oriented || this.cube.quaternion.angleTo(target) < 1e-6) {
      this.oriented = true
      this.cube.quaternion.copy(target)
      this.afterTurn()
      return
    }
    const from = this.cube.quaternion.clone()
    this.setHovered(null)
    this.turnTween = this.tween(
      TURN_MS,
      (k) => this.cube.quaternion.slerpQuaternions(from, target, easeOutBack(k)),
      () => {
        this.cube.quaternion.copy(target)
        this.turnTween = null
        this.afterTurn()
      },
    )
  }

  setTiles(visuals: readonly TileVisual[]): void {
    const animate = this.options.mode === 'board' && this.painted
    this.painted = true
    for (const tile of this.tiles) {
      const next = visuals[tile.location]
      if (!next || (tile.visual && sameTileVisual(tile.visual, next))) continue
      const previous = tile.visual
      tile.visual = next
      this.paint(tile, previous, next, animate)
    }
    this.invalidate()
  }

  setInteractive(on: boolean): void {
    this.interactive = on
    this.setHovered(on && this.lastPointer ? this.pick(this.lastPointer.x, this.lastPointer.y) : null)
  }

  playLoss(locationId: number): void {
    const tile = this.byLocation.get(locationId)
    if (!tile) return
    const material = tile.mesh.material
    this.tween(
      LOSS_MS,
      (k) => {
        material.emissive.copy(LOSS_EMISSIVE)
        material.emissiveIntensity = (1 - k) * 0.9
        const sink = Math.sin(Math.min(1, k * 1.6) * Math.PI) * LOSS_DEPTH
        tile.mesh.position.copy(tile.rest).addScaledVector(tile.normal, -sink)
      },
      () => this.applyHover(tile),
    )
  }

  setHighlightFace(face: CubeFace | null): void {
    if (!this.highlight) return
    this.highlight.visible = face !== null
    if (face) {
      this.highlight.quaternion.setFromRotationMatrix(faceBasis(face))
      this.highlight.position.copy(vec(FACE_NORMALS[face])).multiplyScalar(1.004)
    }
    this.invalidate()
  }

  resize(width: number, height: number): void {
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    const aspect = width / height
    // How much of the world is visible across the canvas's height at the face
    // plane, chosen so the two-unit face covers `faceFraction` of the shorter side.
    const visibleHeight = 2 / this.options.faceFraction / Math.min(1, aspect)
    this.camera.aspect = aspect
    this.camera.position.set(0, 0, 1 + visibleHeight / 2 / Math.tan(MathUtils.degToRad(FOV / 2)))
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frameHandle)
    for (const cleanup of this.cleanups) cleanup()
    for (const material of this.overlayMaterials) material.dispose()
    for (const resource of this.owned) resource.dispose()
    this.renderer.dispose()
    // Releases the context now rather than whenever the browser collects it.
    // React's development double-mount would otherwise stack contexts up.
    this.renderer.forceContextLoss()
  }

  // ── setup ─────────────────────────────────────────────────────────────────

  private install(source: Object3D, shield: Texture): void {
    this.shieldTexture = shield
    const root = source.clone(true)
    this.cube.add(root)

    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      if (object.userData.role === 'body') this.hitTargets.push(object)
      const face = object.userData.face as CubeFace | undefined
      if (!face) return

      // The model shares one material across all 54 tiles; each needs its own.
      const mesh = object as TileMesh
      mesh.material = mesh.material.clone()
      this.owned.push(mesh.material)
      const tile: Tile = {
        mesh,
        face,
        location: object.userData.location as number,
        rest: mesh.position.clone(),
        normal: vec(FACE_NORMALS[face]),
        visual: null,
        shield: null,
        hatch: null,
      }
      this.tiles.push(tile)
      this.byLocation.set(tile.location, tile)
      this.byMesh.set(mesh, tile)
      this.hitTargets.push(mesh)
    })

    if (this.options.mode === 'mini') {
      // A three-quarter view showing home, up and right.
      this.viewTilt.setFromEuler(new Euler(0.45, -0.6, 0))
      this.cube.quaternion.copy(this.viewTilt)
      this.oriented = true
      this.highlight = this.buildHighlight()
      this.cube.add(this.highlight)
    }
    this.invalidate()
  }

  /** A yellow frame laid on a face of the mini cube: where the main cube is looking. */
  private buildHighlight(): Mesh {
    const outer = 0.97
    const inner = 0.87
    const shape = new Shape()
      .moveTo(-outer, -outer)
      .lineTo(outer, -outer)
      .lineTo(outer, outer)
      .lineTo(-outer, outer)
      .closePath()
    shape.holes.push(
      new Path()
        .moveTo(-inner, -inner)
        .lineTo(-inner, inner)
        .lineTo(inner, inner)
        .lineTo(inner, -inner)
        .closePath(),
    )
    const geometry = new ShapeGeometry(shape)
    const material = new MeshBasicMaterial({ color: HOVER_EMISSIVE, toneMapped: false })
    this.owned.push(geometry, material)
    const mesh = new Mesh(geometry, material)
    mesh.visible = false
    return mesh
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler)
    this.cleanups.push(() => target.removeEventListener(type, handler))
  }

  private listenForPlacement(target: HTMLElement): void {
    this.listen(target, 'pointermove', (event) => {
      const { clientX, clientY } = event as PointerEvent
      this.lastPointer = { x: clientX, y: clientY }
      this.setHovered(this.pick(clientX, clientY))
    })
    this.listen(target, 'pointerleave', () => {
      this.lastPointer = null
      this.setHovered(null)
    })
    this.listen(target, 'click', (event) => {
      const { clientX, clientY } = event as MouseEvent
      const tile = this.pick(clientX, clientY)
      if (tile) this.options.onPick?.(tile.location)
    })
  }

  /** Drag spins about the screen's axes; a tap names the face under it. */
  private listenForSpin(canvas: HTMLCanvasElement): void {
    this.listen(canvas, 'pointerdown', (event) => {
      const { clientX, clientY, pointerId } = event as PointerEvent
      this.drag = { x: clientX, y: clientY, travel: 0 }
      canvas.setPointerCapture(pointerId)
    })
    this.listen(canvas, 'pointermove', (event) => {
      if (!this.drag) return
      const { clientX, clientY } = event as PointerEvent
      const dx = clientX - this.drag.x
      const dy = clientY - this.drag.y
      this.drag = { x: clientX, y: clientY, travel: this.drag.travel + Math.abs(dx) + Math.abs(dy) }
      const distance = Math.hypot(dx, dy)
      if (distance === 0) return
      // Screen-down is -Y in the scene, so a downward drag tips the top toward you.
      const axis = new Vector3(dy, dx, 0).normalize()
      this.cube.quaternion.premultiply(
        new Quaternion().setFromAxisAngle(axis, distance * DRAG_RADIANS_PER_PIXEL),
      )
      this.invalidate()
    })
    this.listen(canvas, 'pointerup', (event) => {
      const drag = this.drag
      this.drag = null
      if (!drag || drag.travel >= TAP_SLOP) return
      const { clientX, clientY } = event as PointerEvent
      const face = this.facePick(clientX, clientY)
      if (face) this.options.onFacePick?.(face)
    })
    this.listen(canvas, 'pointercancel', () => {
      this.drag = null
    })
  }

  // ── tiles ─────────────────────────────────────────────────────────────────

  private paint(tile: Tile, previous: TileVisual | null, next: TileVisual, animate: boolean): void {
    const material = tile.mesh.material
    const target = new Color(next.color)
    if (animate) {
      const from = material.color.clone()
      this.tween(PAINT_MS, (k) => material.color.lerpColors(from, target, easeOutCubic(k)))
      if (next.kind === 'piece' && previous?.kind !== 'piece') this.press(tile)
    } else {
      material.color.copy(target)
    }
    this.setOverlay(tile, 'shield', next.shielded)
    this.setOverlay(tile, 'hatch', next.kind === 'desecrated')
  }

  private press(tile: Tile): void {
    this.tween(PRESS_MS, (k) => {
      tile.mesh.position.copy(tile.rest).addScaledVector(tile.normal, -Math.sin(k * Math.PI) * PRESS_DEPTH)
    })
  }

  /**
   * A plane lying on the tile's top, square to its face with the face's north
   * up. A child of the tile so it rides the press, placed from the tile's rest
   * pose so a press in flight cannot skew it.
   */
  private setOverlay(tile: Tile, which: 'shield' | 'hatch', on: boolean): void {
    const existing = tile[which]
    if (!on) {
      if (existing) {
        tile.mesh.remove(existing)
        const material = existing.material as MeshBasicMaterial
        material.dispose()
        this.overlayMaterials.delete(material)
        tile[which] = null
      }
      return
    }
    if (existing) return

    const map = which === 'shield' ? this.shieldTexture : this.hatch()
    const material = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false })
    this.overlayMaterials.add(material)
    const overlay = new Mesh(which === 'shield' ? this.shieldGeometry : this.hatchGeometry, material)

    const lift = which === 'shield' ? 0.006 : 0.003
    const wanted = faceBasis(tile.face).setPosition(
      tile.rest.clone().addScaledVector(tile.normal, TILE_SURFACE + lift),
    )
    const tileAtRest = new Matrix4().compose(tile.rest, tile.mesh.quaternion, tile.mesh.scale)
    tileAtRest.invert().multiply(wanted).decompose(overlay.position, overlay.quaternion, overlay.scale)

    tile.mesh.add(overlay)
    tile[which] = overlay
  }

  private hatch(): CanvasTexture {
    if (!this.hatchTexture) {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const context = canvas.getContext('2d')
      if (context) {
        context.strokeStyle = 'rgba(20, 16, 12, 0.6)'
        context.lineWidth = 6
        for (let x = -64; x < 128; x += 16) {
          context.beginPath()
          context.moveTo(x, 64)
          context.lineTo(x + 64, 0)
          context.stroke()
        }
      }
      this.hatchTexture = new CanvasTexture(canvas)
      this.hatchTexture.colorSpace = SRGBColorSpace
      this.owned.push(this.hatchTexture)
    }
    return this.hatchTexture
  }

  // ── picking ───────────────────────────────────────────────────────────────

  /** The front-face tile under a point, or null. Never answers mid-turn or out of turn. */
  private pick(clientX: number, clientY: number): Tile | null {
    if (!this.interactive || this.turnTween) return null
    const hit = this.raycast(clientX, clientY)
    const tile = hit ? this.byMesh.get(hit.object) ?? null : null
    if (!tile) return null
    return vec(FACE_NORMALS[tile.face]).applyQuaternion(this.cube.quaternion).z > 0.99 ? tile : null
  }

  private facePick(clientX: number, clientY: number): CubeFace | null {
    const hit = this.raycast(clientX, clientY)
    if (!hit) return null
    const tile = this.byMesh.get(hit.object)
    if (tile) return tile.face
    return hit.face ? nearestFace(hit.face.normal) : null
  }

  private raycast(clientX: number, clientY: number): Intersection | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    // World matrices are otherwise only refreshed by a render. Without this a
    // pick in the same tick a turn lands, or after a resize, reads last frame's
    // cube. The body is in the list so a ray through a grout line stops there.
    this.scene.updateMatrixWorld()
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return this.raycaster.intersectObjects(this.hitTargets, false)[0] ?? null
  }

  private setHovered(tile: Tile | null): void {
    if (tile === this.hovered) return
    const previous = this.hovered
    this.hovered = tile
    if (previous) this.applyHover(previous)
    if (tile) this.applyHover(tile)
    this.options.pointerTarget?.classList.toggle('cube3d-can-place', tile !== null)
    this.invalidate()
  }

  private applyHover(tile: Tile): void {
    const material = tile.mesh.material
    const on = tile === this.hovered
    material.emissive.copy(on ? HOVER_EMISSIVE : NO_EMISSIVE)
    material.emissiveIntensity = on ? 0.14 : 1
    this.invalidate()
  }

  private afterTurn(): void {
    this.invalidate()
    if (this.lastPointer) this.setHovered(this.pick(this.lastPointer.x, this.lastPointer.y))
  }

  // ── frames ────────────────────────────────────────────────────────────────

  private tween(duration: number, update: (k: number) => void, done?: () => void): Tween {
    const tween: Tween = { start: performance.now(), duration, update, done, cancelled: false }
    this.tweens.add(tween)
    this.invalidate()
    return tween
  }

  private invalidate(): void {
    if (this.frameRequested || this.disposed) return
    this.frameRequested = true
    this.frameHandle = requestAnimationFrame((now) => this.frame(now))
  }

  private frame(now: number): void {
    this.frameRequested = false
    for (const tween of this.tweens) {
      if (tween.cancelled) {
        this.tweens.delete(tween)
        continue
      }
      const k = Math.min(1, Math.max(0, (now - tween.start) / tween.duration))
      tween.update(k)
      if (k === 1) {
        this.tweens.delete(tween)
        tween.done?.()
      }
    }
    this.renderer.render(this.scene, this.camera)
    if (this.tweens.size > 0) this.invalidate()
  }
}
