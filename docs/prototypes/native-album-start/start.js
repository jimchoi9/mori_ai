const input=document.getElementById('photos'),status=document.getElementById('status'),results=document.getElementById('results'),reset=document.getElementById('reset');
let selections=0;
document.getElementById('new-album').addEventListener('click',()=>{
 // Keep this synchronous in the user's tap. No API or route change precedes it.
 input.value='';
 input.click();
});
input.addEventListener('change',()=>{
 const files=Array.from(input.files??[]);input.value='';if(!files.length)return;
 selections++;
 const card=document.createElement('article'),title=document.createElement('h2'),note=document.createElement('p'),list=document.createElement('ul');
 title.textContent=`사진 ${files.length}장 선택 확인`;
 note.textContent='실제 서비스에서는 이 시점부터 앨범 생성·업로드로 이어집니다. 이 테스트에서는 전송하지 않습니다.';
 for(const file of files){const row=document.createElement('li');row.textContent=file.name;list.append(row);}
 card.append(title,note,list);results.prepend(card);reset.hidden=false;
 status.textContent=`사진 선택 ${selections}회를 확인했어요. 실제로 생성한 앨범은 없습니다.`;
});
input.addEventListener('cancel',()=>{status.textContent='사진 선택을 취소했어요. 새 앨범 생성 요청은 보내지 않았습니다.';});
reset.addEventListener('click',()=>{selections=0;input.value='';results.replaceChildren();reset.hidden=true;status.textContent='아직 사진을 선택하지 않았어요.';});
