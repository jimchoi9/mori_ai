import {useRef} from 'react';
import {useParams} from 'react-router';
import {NfcExperience} from './NfcExperience';
import {ownerSource} from './ownerSource';
export function AlbumMemoryViewer({userId:_userId}:{userId:string}){
 const {albumId=''}=useParams(),source=useRef<ReturnType<typeof ownerSource>|null>(null);
 if(!source.current)source.current=ownerSource(albumId);
 return <NfcExperience source={source.current}/>;
}
