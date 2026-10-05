import { SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import shieldIconUrl from '../assets/icons/battle/powerup-immune.png'
import cubeModelUrl from '../assets/models/cube.glb?url'

/*
 * Loaded once per page and shared by every scene, which clones the model. A
 * failed load is forgotten, so the next mount tries again rather than failing
 * forever on a cached rejection.
 *
 * Shared means never disposed by a scene: the geometry and the texture outlive
 * any one canvas. Both are tiny.
 */

let model: Promise<GLTF> | null = null
let shield: Promise<Texture> | null = null

export function loadCubeModel(): Promise<GLTF> {
  model ??= new GLTFLoader().loadAsync(cubeModelUrl).catch((error: unknown) => {
    model = null
    throw error
  })
  return model
}

export function loadShieldTexture(): Promise<Texture> {
  shield ??= new TextureLoader()
    .loadAsync(shieldIconUrl)
    .then((texture) => {
      texture.colorSpace = SRGBColorSpace
      return texture
    })
    .catch((error: unknown) => {
      shield = null
      throw error
    })
  return shield
}
