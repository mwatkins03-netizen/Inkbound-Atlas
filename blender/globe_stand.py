"""Inkbound — 18th-century terrestrial globe stand.

Builds a c. 1750 English table globe in the manner of Adams / Senex: brass meridian ring with a flat
engraved band, brass hour circle at the north pole, a mahogany horizon ring carrying the paper calendar
band, four turned baluster legs on a cross stretcher, and a compass box under glass at the crossing.
Wood grain is a procedural Cycles material baked to a 2K texture so the glTF carries it.

Run headless:
  Blender -b -P blender/globe_stand.py -- --out assets/globe-stand.glb --preview assets/globe-stand-preview.png
Mesh names matter: three.js swaps canvas textures onto MeridianRing, HourCircle, HorizonBand and CompassCard,
and hides GlobeBall (the ball is rendered by the site with the generated map).
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
OUT = os.path.abspath(arg('--out', 'assets/globe-stand.glb'))
PREVIEW = arg('--preview', '')
BAKE = '--no-bake' not in argv

R = 1.0  # globe radius; everything is scaled from the ball

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

def new_object(name, mesh):
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    return ob

def set_smooth(ob, angle=math.radians(35)):
    for p in ob.data.polygons:
        p.use_smooth = True
    try:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=angle)
        ob.select_set(False)
    except Exception:
        pass

# ---------------------------------------------------------------- materials
def principled(name, color, metallic=0.0, roughness=0.5, **extra):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    for k, v in extra.items():
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = v
    return m

brass = principled('Brass', (0.86, 0.64, 0.30), metallic=1.0, roughness=0.30)
brass_dark = principled('BrassAged', (0.62, 0.44, 0.20), metallic=1.0, roughness=0.42)
paper = principled('PaperBand', (0.90, 0.84, 0.68), roughness=0.85)
card = principled('CompassCard', (0.92, 0.87, 0.72), roughness=0.9)
glass = principled('Glass', (0.9, 0.95, 0.98), roughness=0.05)
glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
glass.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.22
glass.surface_render_method = 'BLENDED'
felt = principled('Felt', (0.16, 0.22, 0.14), roughness=1.0)

def wood_material(name, dark, light, scale=3.0, distortion=2.2):
    """Procedural mahogany: warped wave bands with fine noise, ready to bake."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.38
    bsdf.inputs['Coat Weight'].default_value = 0.35
    bsdf.inputs['Coat Roughness'].default_value = 0.2
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (scale, scale * 0.35, scale)
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'; wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 4.0
    wave.inputs['Distortion'].default_value = distortion
    wave.inputs['Detail'].default_value = 6.0
    wave.inputs['Detail Scale'].default_value = 2.5
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 28.0
    noise.inputs['Detail'].default_value = 8.0
    noise.inputs['Roughness'].default_value = 0.7
    mixf = nt.nodes.new('ShaderNodeMix'); mixf.data_type = 'FLOAT'
    mixf.inputs['Factor'].default_value = 0.22
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].color = (*light, 1)
    mid = ramp.color_ramp.elements.new(0.55)
    mid.color = ((dark[0] + light[0]) * 0.45, (dark[1] + light[1]) * 0.45, (dark[2] + light[2]) * 0.45, 1)
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], wave.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    nt.links.new(wave.outputs['Fac'], mixf.inputs[2])
    nt.links.new(noise.outputs['Fac'], mixf.inputs[3])
    nt.links.new(mixf.outputs[0], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return m

mahogany = wood_material('Mahogany', (0.16, 0.06, 0.03), (0.46, 0.20, 0.09))
oak_table = wood_material('TableOak', (0.20, 0.11, 0.05), (0.42, 0.26, 0.12), scale=1.2, distortion=1.4)

# ---------------------------------------------------------------- geometry helpers
def annulus(name, r_in, r_out, thick, segments=256, material=None, strip_uv=True):
    """Flat ring in the XY plane centred on the origin, z from -thick/2 to +thick/2.
    UVs: u = angle/2π, v = radial position on the flat faces; side faces are pushed to v≈0 margin."""
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new('UVMap')
    top_in, top_out, bot_in, bot_out = [], [], [], []
    for i in range(segments):
        a = i / segments * math.tau
        c, s = math.cos(a), math.sin(a)
        top_in.append(bm.verts.new((r_in * c, r_in * s, thick / 2)))
        top_out.append(bm.verts.new((r_out * c, r_out * s, thick / 2)))
        bot_in.append(bm.verts.new((r_in * c, r_in * s, -thick / 2)))
        bot_out.append(bm.verts.new((r_out * c, r_out * s, -thick / 2)))
    faces = []
    for i in range(segments):
        j = (i + 1) % segments
        u0, u1 = i / segments, (i + 1) / segments
        if j == 0:
            u1 = 1.0
        def quad(vs, uvs):
            f = bm.faces.new(vs)
            for loop, uv in zip(f.loops, uvs):
                loop[uv_layer].uv = uv
            faces.append(f)
        quad((top_in[i], top_out[i], top_out[j], top_in[j]), ((u0, 0.06), (u0, 1.0), (u1, 1.0), (u1, 0.06)))
        quad((bot_out[i], bot_in[i], bot_in[j], bot_out[j]), ((u0, 1.0), (u0, 0.06), (u1, 0.06), (u1, 1.0)))
        quad((top_out[i], bot_out[i], bot_out[j], top_out[j]), ((u0, 0.0), (u0, 0.04), (u1, 0.04), (u1, 0.0)))
        quad((bot_in[i], top_in[i], top_in[j], bot_in[j]), ((u0, 0.04), (u0, 0.0), (u1, 0.0), (u1, 0.04)))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = new_object(name, me)
    if material:
        me.materials.append(material)
    return ob

def lathe(name, profile, segments=48, material=None):
    """Revolve a (radius, z) profile around Z. Profile must run monotonic in z, first/last radius may be 0."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=segments, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = new_object(name, me)
    if material:
        me.materials.append(material)
    return ob

def box(name, size, location, material=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    if material:
        ob.data.materials.append(material)
    return ob

def bevel(ob, width=0.006, segments=3):
    mod = ob.modifiers.new('Bevel', 'BEVEL')
    mod.width = width; mod.segments = segments; mod.limit_method = 'ANGLE'

# ---------------------------------------------------------------- the globe ball (placeholder for preview)
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=R)
ball = bpy.context.active_object
ball.name = 'GlobeBall'
ball.data.materials.append(paper)
set_smooth(ball)

# ---------------------------------------------------------------- meridian ring (vertical, brass, flat band)
meridian = annulus('MeridianRing', R * 1.045, R * 1.105, R * 0.012, segments=360, material=brass)
meridian.rotation_euler = (math.radians(90), 0, 0)   # into the XZ plane
set_smooth(meridian, math.radians(20))

# axis pins through the poles, hour circle on the north pin
for zsign, nm in ((1, 'AxisPinN'), (-1, 'AxisPinS')):
    pin = lathe(nm, [(0, 0), (0.028, 0), (0.028, 0.11), (0.018, 0.115), (0.018, 0.16), (0, 0.16)], 32, brass_dark)
    pin.location = (0, 0, zsign * (R * 0.97))
    if zsign < 0:
        pin.rotation_euler = (math.pi, 0, 0)
hour = annulus('HourCircle', R * 0.03, R * 0.135, R * 0.008, segments=96, material=brass)
hour.location = (0, 0, R * 1.112)
hand = box('HourHand', (0.11, 0.012, 0.006), (0.045, 0, R * 1.12), brass_dark)

# ---------------------------------------------------------------- horizon ring (mahogany body, paper band on top)
horizon = annulus('HorizonRing', R * 1.15, R * 1.50, R * 0.055, segments=256, material=mahogany)
band = annulus('HorizonBand', R * 1.17, R * 1.47, R * 0.004, segments=256, material=paper)
band.location = (0, 0, R * 0.0295)
brass_lip = annulus('HorizonLipOuter', R * 1.495, R * 1.515, R * 0.045, segments=256, material=brass_dark)
brass_lip_in = annulus('HorizonLipInner', R * 1.14, R * 1.155, R * 0.045, segments=256, material=brass_dark)

# ---------------------------------------------------------------- legs: turned balusters
leg_profile = [
    (0.000, 0.00), (0.070, 0.00), (0.070, -0.045), (0.050, -0.06), (0.058, -0.12), (0.075, -0.19),
    (0.080, -0.26), (0.062, -0.33), (0.045, -0.37), (0.052, -0.41), (0.070, -0.47), (0.086, -0.56),
    (0.090, -0.66), (0.078, -0.75), (0.058, -0.80), (0.052, -0.84), (0.066, -0.88), (0.060, -0.94),
    (0.048, -1.02), (0.056, -1.06), (0.082, -1.10), (0.094, -1.16), (0.090, -1.22), (0.100, -1.26),
    (0.110, -1.30), (0.100, -1.34), (0.000, -1.34)]
leg_radius = R * 1.33
legs = []
for k in range(4):
    a = math.radians(45 + 90 * k)
    leg = lathe(f'Leg{k+1}', leg_profile, 40, mahogany)
    leg.location = (math.cos(a) * leg_radius, math.sin(a) * leg_radius, -R * 0.0275)
    set_smooth(leg)
    legs.append(leg)
    cap = annulus(f'LegCap{k+1}', 0.0, 0.074, 0.012, 48, brass_dark)
    cap.location = (math.cos(a) * leg_radius, math.sin(a) * leg_radius, -R * 0.0275 - 0.004)

# ---------------------------------------------------------------- cross stretchers + compass box
stretch_z = -R * 1.05
for k, rot in enumerate((math.radians(45), math.radians(135))):
    bar = box(f'Stretcher{k+1}', (leg_radius * 2 - 0.02, 0.062, 0.042), (0, 0, stretch_z), mahogany, (0, 0, rot))
    bevel(bar, 0.008)
compass_body = lathe('CompassBox', [(0, 0), (0.30, 0), (0.30, 0.09), (0.27, 0.09), (0.27, 0.02), (0, 0.02)], 96, mahogany)
compass_body.location = (0, 0, stretch_z + 0.021)
compass_rim = annulus('CompassRim', 0.265, 0.305, 0.012, 128, brass)
compass_rim.location = (0, 0, stretch_z + 0.115)
compass_card = annulus('CompassCard', 0.0, 0.27, 0.003, 128, card)
compass_card.location = (0, 0, stretch_z + 0.045)
compass_glass = annulus('CompassGlass', 0.0, 0.27, 0.004, 128, glass)
compass_glass.location = (0, 0, stretch_z + 0.105)
needle = box('CompassNeedle', (0.36, 0.018, 0.004), (0, 0, stretch_z + 0.06), brass_dark, (0, 0, math.radians(20)))
pivot = lathe('CompassPivot', [(0, 0), (0.014, 0), (0.014, 0.03), (0, 0.03)], 24, brass_dark)
pivot.location = (0, 0, stretch_z + 0.045)
# brass bracket holding the meridian ring at the bottom
bracket = box('MeridianBracket', (0.06, 0.05, 0.16), (0, 0, -R * 1.17), brass_dark)
bracket_clip = annulus('MeridianClip', R * 1.10, R * 1.13, 0.05, 360, brass_dark)
bracket_clip.rotation_euler = (math.radians(90), 0, 0)
# keep only the lowest 12° of the clip as a cradle
bm = bmesh.new(); bm.from_mesh(bracket_clip.data)
geom = [v for v in bm.verts if (v.co.y) > -R * 1.10 * math.cos(math.radians(6))]
bmesh.ops.delete(bm, geom=geom, context='VERTS')
bm.to_mesh(bracket_clip.data); bm.free()

# ---------------------------------------------------------------- table
table = lathe('Table', [(0, -R * 1.34 - 0.08), (2.4, -R * 1.34 - 0.08), (2.4, -R * 1.34), (0, -R * 1.34)], 128, oak_table)
felt_disc = lathe('TableFelt', [(0, -R * 1.34), (2.0, -R * 1.34), (2.0, -R * 1.34 + 0.003), (0, -R * 1.34 + 0.003)], 128, felt)

for ob in (horizon, band, brass_lip, brass_lip_in, hour, compass_body, compass_rim):
    set_smooth(ob, math.radians(30))

# ---------------------------------------------------------------- bake wood grain to textures
def bake_wood(objects, mat, size=2048, samples=8):
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.device = 'CPU'
    img = bpy.data.images.new(mat.name + '_bake', size, size)
    nt = mat.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'BakeUV'
    nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
    nt.nodes.active = tex
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        if 'BakeUV' not in ob.data.uv_layers:
            ob.data.uv_layers.new(name='BakeUV')
        ob.data.uv_layers.active = ob.data.uv_layers['BakeUV']
    # one shared UV space: pack all islands together
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = 6
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE', use_clear=True)
    path = os.path.join(os.path.dirname(OUT), mat.name.lower() + '-grain.png')
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    # rewire: baked image drives base colour for export
    bsdf = nt.nodes['Principled BSDF']
    for l in list(nt.links):
        if l.to_node == bsdf and l.to_socket.name == 'Base Color':
            nt.links.remove(l)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    for ob in objects:
        # make the baked UV the one glTF exports (first/active render layer)
        ob.data.uv_layers['BakeUV'].active_render = True
        for uv in ob.data.uv_layers:
            if uv.name != 'BakeUV':
                ob.data.uv_layers.remove(uv)
    return path

wood_objects = [ob for ob in scene.objects if ob.type == 'MESH' and ob.data.materials and ob.data.materials[0] == mahogany]
if BAKE:
    try:
        bake_wood(wood_objects, mahogany, 2048, 8)
        bake_wood([table], oak_table, 1024, 8)
    except Exception as e:  # fall back to flat colour
        print('BAKE FAILED', e)
        for m, col in ((mahogany, (0.30, 0.12, 0.05)), (oak_table, (0.30, 0.18, 0.08))):
            bsdf = m.node_tree.nodes['Principled BSDF']
            for l in list(m.node_tree.links):
                if l.to_node == bsdf and l.to_socket.name == 'Base Color':
                    m.node_tree.links.remove(l)
            bsdf.inputs['Base Color'].default_value = (*col, 1)

# ---------------------------------------------------------------- export glTF
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
                          export_image_format='AUTO', export_cameras=False, export_lights=False)
print('EXPORTED', OUT, os.path.getsize(OUT))

# ---------------------------------------------------------------- preview render
if PREVIEW:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1400, 1000
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('World'); scene.world = world; world.use_nodes = True
    bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.05, 0.035, 0.025, 1); bg.inputs['Strength'].default_value = 0.6
    def light(name, kind, loc, energy, color=(1, 1, 1), size=1.0):
        ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
        if kind == 'AREA':
            ld.size = size
        lo = bpy.data.objects.new(name, ld); scene.collection.objects.link(lo); lo.location = loc
        lo.rotation_euler = (Vector(loc)).to_track_quat('Z', 'Y').to_euler()
        return lo
    light('Key', 'AREA', (3.2, -3.0, 2.6), 900, (1.0, 0.86, 0.66), 2.2)
    light('Fill', 'AREA', (-3.5, -1.5, 1.2), 250, (0.7, 0.8, 1.0), 3.0)
    light('Rim', 'AREA', (-1.0, 3.5, 2.4), 500, (1.0, 0.92, 0.8), 1.5)
    cam_data = bpy.data.cameras.new('Camera'); cam_data.lens = 60
    cam = bpy.data.objects.new('Camera', cam_data); scene.collection.objects.link(cam)
    cam.location = (3.6, -4.4, 1.6)
    cam.rotation_euler = (Vector((3.6, -4.4, 1.6)) - Vector((0, 0, -0.35))).to_track_quat('Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.abspath(PREVIEW)
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', scene.render.filepath)
