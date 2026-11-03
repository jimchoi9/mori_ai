import type {ReactNode} from 'react';
export function LoginView({hero,actions,feedback}:{hero:ReactNode;actions:ReactNode;feedback?:ReactNode}) {
 return <section className="mori-login"><div className="mori-wordmark" aria-label="mori">mori</div><h1 className="mori-login-heading">mori 로그인</h1><div className="mori-login-hero">{hero}</div><div className="mori-login-actions">{actions}</div>{feedback && <div className="mori-login-feedback">{feedback}</div>}</section>;
}
