"""Own synthetic two-image HEIC; run in the pinned Linux codec image."""
import hashlib,json
from pathlib import Path
from PIL import Image
import pillow_heif
root=Path('tests/fixtures/media')
def frame(gps,color):
 image=Image.new('RGB',(64,48),color);exif=Image.Exif()
 exif[34853]={1:'N',2:gps[0],3:'E',4:gps[1]}
 image.info['exif']=exif.tobytes()
 return image
h=pillow_heif.from_pillow(frame(((37,33,36),(126,58,12)),'blue'))
h.add_from_pillow(frame(((35,14,24),(129,13,12)),'green'))
p=root/'capture-primary-gps.heic';h.save(p,primary_index=1,quality=30)
pillow_heif.register_heif_opener()
with Image.open(p) as im:
 assert im.getexif().get_ifd(34853)[2][0]==35
manifest=root/'manifest.json';data=json.loads(manifest.read_text())
data['fixtures']=[r for r in data['fixtures'] if r['path']!=p.name]
data['fixtures'].append({'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'stored_size':[64,48],'expected_size':[64,48],'orientation':1,'alpha':False,'input_is_3_4':False,'primary_index':1,'expected_gps':{'latitude':35.24,'longitude':129.22},'ownership':'generated synthetic; no user data','generator':'Pillow GPS EXIF + pillow-heif from_pillow/add_from_pillow; save(primary_index=1,quality=30)'})
manifest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('Synthetic primary-GPS HEIC generated and primary metadata verified.')
