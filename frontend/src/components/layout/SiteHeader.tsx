import type {ReactNode} from 'react';
import {Link,useLocation} from 'react-router';
import './siteHeader.css';

export function SiteHeader({account,children}:{account:ReactNode;children?:ReactNode}){
 const location=useLocation();
 return <header className="mori-site-header"><Link className="mori-home-brand" to="/goods" aria-label="Mori 홈" onClick={event=>{if(location.pathname==='/goods')event.preventDefault();}}><span className="mori-home-mark" aria-hidden="true">m</span><span>Mori</span></Link><div className="mori-header-actions">{children}{account}</div></header>;
}
