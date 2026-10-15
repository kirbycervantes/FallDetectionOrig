import trimesh, numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
s=trimesh.load('_preview.glb')
light=np.array([0.4,-0.6,0.7]);light/=np.linalg.norm(light)
def draw(ax,m,col,a=1):
    sh=0.35+0.65*np.clip(m.face_normals@light,0,1)
    c=np.array(col)[None,:]*sh[:,None]
    ax.add_collection3d(Poly3DCollection(m.triangles,facecolors=np.c_[c,np.full(len(c),a)],edgecolor='none'))
fig=plt.figure(figsize=(16,11))
views=[(30,-60,True,False),(30,-130,True,False),(60,-90,False,True),(20,-30,True,True)]
for k,(el,az,withbase,lidon) in enumerate(views):
    ax=fig.add_subplot(2,2,k+1,projection='3d')
    for n,m in s.geometry.items():
        col=np.array(m.visual.material.baseColorFactor[:3])/255
        m=m.copy()
        if n=='base' and not withbase: continue
        if n=='lid' or n.startswith('lid|'):
            if not lidon: continue
            m.apply_translation([0,0,0 if k==3 else 30])
        draw(ax,m,col, 0.35 if (n=='lid' and k!=3) else 1)
    ax.set_xlim(-30,100);ax.set_ylim(-20,90);ax.set_zlim(0,70);ax.set_box_aspect((130,110,70))
    ax.view_init(el,az);ax.set_axis_off()
plt.tight_layout();plt.savefig(r'C:/Windows/Temp/claude/C--Users-User-AppData-Roaming-Claude-scratch-workspaces-2497af55-f7c7-418c-aec5-b50b8574d771-1403450e-d6c0-483b-920b-4597ac0e2e12-scratch-2026-09-29-05c5a8/f050621f-1bc0-49cb-a4d0-37cfefbe8017/scratchpad/views2.png',dpi=65)
