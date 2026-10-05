"""
Builds the cube for the cube-3d lab prototype: `cube.blend` next to this file,
and `web/src/assets/models/cube.glb`, which the game and the lab page both load.

    "F:/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python build_cube.py

This script is the source of truth. Tweak the constants and re-run rather than
hand-editing the .blend, or the next run will overwrite your edits. If you do
sculpt something by hand, export it to web/src/assets/models/cube.glb yourself and stop
running this.

What the page relies on (anything else is fair game):
  - one mesh object named `body`
  - 54 tile objects carrying custom properties `face`, `cell` and `location`,
    which export as glTF extras and arrive in three.js as `userData`

Faces and cells follow the game's own model in packages/game-core/src/topology.ts:
home = +Z, up = +Y, right = +X in three.js space, each face read from outside
the cube in the frame CUBE_ADJACENCY assumes, cell 0 top-left, row-major.
`location` = faceIndex * 9 + cell, the same absolute IDs the web client uses.
"""

from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
BLEND_PATH = HERE / "cube.blend"
# The app’s copy is the only copy. The lab page reads it through the lab
# server’s /game/ mapping, so the prototype and the game can never disagree.
GLB_PATH = HERE.parents[3] / "web" / "src" / "assets" / "models" / "cube.glb"

HALF = 1.0            # the body spans -1..1
BODY_BEVEL = 0.10
BODY_SEGMENTS = 6

# Tiles sit in pockets cut into the body rather than standing proud of it. A
# proud tile on a side face pokes out past the front face's silhouette, so a
# head-on view shows slivers of the neighbouring faces' tiles along every edge.
PITCH = 0.58          # centre-to-centre distance between tiles
TILE = 0.50
POCKET = 0.52         # so each tile has a hairline of clearance in its pocket
POCKET_DEPTH = 0.07
TILE_THICK = 0.07
TILE_SINK = 0.004     # how far a tile's top sits below the body's face
TILE_BEVEL = 0.022
TILE_SEGMENTS = 3

BODY_COLOR = (0.018, 0.018, 0.022)
TILE_COLOR = (0.807, 0.761, 0.659)   # #e8e2d4 in linear

# (name, outward normal, right, up) in three.js / game space.
FACES = [
    ("home",  (0, 0, 1),  (1, 0, 0),  (0, 1, 0)),
    ("up",    (0, 1, 0),  (1, 0, 0),  (0, 0, -1)),
    ("down",  (0, -1, 0), (1, 0, 0),  (0, 0, 1)),
    ("left",  (-1, 0, 0), (0, 0, 1),  (0, 1, 0)),
    ("right", (1, 0, 0),  (0, 0, -1), (0, 1, 0)),
    ("back",  (0, 0, -1), (-1, 0, 0), (0, 1, 0)),
]


def to_blender(v):
    """three.js is Y-up, Blender is Z-up; the glTF exporter undoes exactly this."""
    x, y, z = v
    return Vector((x, -z, y))


def material(name, color, roughness):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def bevelled_box(name, size, bevel, segments):
    """A box with the bevel baked into the mesh, hardened so flat faces stay flat."""
    mesh = bpy.data.meshes.new(name + "_raw")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True

    temp = bpy.data.objects.new(name + "_temp", mesh)
    bpy.context.scene.collection.objects.link(temp)
    mod = temp.modifiers.new("Bevel", "BEVEL")
    mod.width = bevel
    mod.segments = segments
    mod.limit_method = "NONE"
    mod.harden_normals = True

    depsgraph = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(temp.evaluated_get(depsgraph))
    baked.name = name
    bpy.data.objects.remove(temp)
    bpy.data.meshes.remove(mesh)
    return baked


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0

    collection = bpy.data.collections.new("Cube")
    bpy.context.scene.collection.children.link(collection)

    body_mat = material("Body", BODY_COLOR, 0.42)
    tile_mat = material("Tile", TILE_COLOR, 0.68)

    pockets = bpy.data.collections.new("Pockets")
    bpy.context.scene.collection.children.link(pockets)

    # The body keeps live modifiers so it can be tuned by hand in the .blend; the
    # exporter applies them. Pockets are cut first, then only the cube's own 12
    # edges are rounded -- they carry a bevel weight and the pocket rims do not.
    body_mesh = bpy.data.meshes.new("body")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=HALF * 2)
    bm.to_mesh(body_mesh)
    bm.free()
    for poly in body_mesh.polygons:
        poly.use_smooth = True
    weights = body_mesh.attributes.new("bevel_weight_edge", "FLOAT", "EDGE")
    weights.data.foreach_set("value", [1.0] * len(body_mesh.edges))
    body_mesh.materials.append(body_mat)
    body = bpy.data.objects.new("body", body_mesh)
    body["role"] = "body"
    collection.objects.link(body)

    cut = body.modifiers.new("Pockets", "BOOLEAN")
    cut.operation = "DIFFERENCE"
    cut.operand_type = "COLLECTION"
    cut.collection = pockets
    cut.solver = "EXACT"

    bevel = body.modifiers.new("Bevel", "BEVEL")
    bevel.width = BODY_BEVEL
    bevel.segments = BODY_SEGMENTS
    bevel.limit_method = "WEIGHT"
    bevel.harden_normals = True

    # One tile mesh shared by all 54 tiles, so the .glb stores it once.
    tile_mesh = bevelled_box("tile", (TILE, TILE, TILE_THICK), TILE_BEVEL, TILE_SEGMENTS)
    tile_mesh.materials.append(tile_mat)

    # Flat-shaded, so the pocket walls the boolean leaves behind are flat too.
    pocket_mesh = bpy.data.meshes.new("pocket")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((POCKET, POCKET, POCKET_DEPTH * 2)), verts=bm.verts)
    bm.to_mesh(pocket_mesh)
    bm.free()

    depth = HALF - TILE_SINK - TILE_THICK / 2
    for face_index, (face, normal, right, up) in enumerate(FACES):
        n, r, u = to_blender(normal), to_blender(right), to_blender(up)
        rotation = Matrix((r, u, n)).transposed().to_4x4()  # columns: r, u, n
        for cell in range(9):
            row, col = divmod(cell, 3)
            across = r * ((col - 1) * PITCH) + u * ((1 - row) * PITCH)

            pocket = bpy.data.objects.new(f"pocket_{face}_{cell}", pocket_mesh)
            pockets.objects.link(pocket)
            pocket.matrix_world = Matrix.Translation(n * HALF + across) @ rotation
            pocket.display_type = "WIRE"
            pocket.hide_render = True

            offset = n * depth + across
            tile = bpy.data.objects.new(f"cell_{face}_{cell}", tile_mesh)
            tile["face"] = face
            tile["cell"] = cell
            tile["location"] = face_index * 9 + cell
            collection.objects.link(tile)
            tile.parent = body
            tile.matrix_world = Matrix.Translation(offset) @ rotation

    # Hidden, not disabled: the boolean still reads them.
    for pocket in pockets.objects:
        pocket.hide_set(True)

    stage_for_preview()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in collection.objects:
        obj.select_set(True)

    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)
    print(f"wrote {GLB_PATH} and {BLEND_PATH}")


def stage_for_preview():
    """A camera and light so F12 in the .blend looks like the page. Not exported."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new("World")
    world.color = (0.01, 0.01, 0.012)
    scene.world = world

    # home is three.js +Z, which is Blender -Y: Blender's own front view.
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 85
    cam = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -9.5, 0)
    cam.rotation_euler = (1.5708, 0, 0)
    scene.camera = cam

    key_data = bpy.data.lights.new("Key", "AREA")
    key_data.energy = 900
    key_data.size = 4
    key = bpy.data.objects.new("Key", key_data)
    scene.collection.objects.link(key)
    key.location = (-3.5, -5, 4)
    key.rotation_euler = (0.9, 0, -0.6)


build()
