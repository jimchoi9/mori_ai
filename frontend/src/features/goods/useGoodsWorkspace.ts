import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, errorText } from '../../api/client';
import { STYLE_IDS, type DesignStyle, type StyleId } from './design/catalog';
import { previewKey, type Placement, type GoodsProduct } from './mockup/preview';
import type { GoodsRevision, GoodsDesign } from './api';
import { abandon, uploadSource, loadSourcePreview } from './api';
import { prepareGoodsSource } from './preprocess';
import { discardMessage, replacePhoto, generationParent } from './workflow';
import type { Me } from '../../api/types';
import { rememberGoodsSave, forgetGoodsSave, type GoodsResume } from './guestIntent';
export type GoodsWorkspaceProps = {
    account?: ReactNode;
    userId: string;
    guest?: Me['guest'];
    consent?: Me['consent'];
    onConsent?: () => Promise<void>;
    resume?: GoodsResume | null;
};
/** Owns work lifecycle and commands; UI and recommendation state remain separate. */
export function useGoodsWorkspace({ userId, guest, consent, onConsent, resume }: GoodsWorkspaceProps) {
    const initialWork = resume?.work_id ?? guest?.work_id ?? null;
    const [product, setProduct] = useState<GoodsProduct>(resume?.product ?? 'keyring');
    const productLabel = product === 'magnet' ? '마그네틱' : '키링';
    const [loginBusy, setLoginBusy] = useState(false);
    const [showLogin, setShowLogin] = useState(false);
    const [agreed, setAgreed] = useState(false);
    const [remaining, setRemaining] = useState<number | null>(guest?.remaining ?? null);
    const createIntent = useRef(crypto.randomUUID());
    const tail = useRef<HTMLDivElement>(null);
    const restoring = useRef(!!initialWork);
    async function ensureConsent() {
        if (consent?.required) {
            if (!agreed)
                throw Error('사진 처리 안내에 동의해 주세요.');
            await onConsent?.();
        }
    }
    const [step, setStep] = useState(resume ? 3 : 1);
    const [style, setStyle] = useState<StyleId | null>('free');
    const [work, setWork] = useState<string | null>(initialWork);
    const [source, setSource] = useState('');
    const [sourceAttached, setSourceAttached] = useState(true);
    const selectionTouched = useRef(false);
    const [selected, setSelected] = useState<string | null>(resume?.revision_id ?? null);
    const [draft, setDraft] = useState('');
    const [rows, setRows] = useState<GoodsRevision[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState<GoodsDesign | null>(null);
    const [preview, setPreview] = useState<{
        key: string;
        status: string;
    } | null>(null);
    const [placement, setPlacement] = useState<Placement>(resume?.placement ?? { holeX: .5, holeY: 0, widthMm: 50 });
    const uploadController = useRef<AbortController | null>(null);
    const live = useRef(true);
    const epoch = useRef(0);
    const workRef = useRef<string | null>(initialWork);
    const sourceRef = useRef('');
    const savedRef = useRef(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const pending = useRef<{
        body: string;
        key: string;
    } | null>(null);
    const catalog = useQuery({ queryKey: ['goods-catalog', userId], queryFn: ({ signal }) => api<{
            styles: DesignStyle[];
            suggestions_enabled?: boolean;
        }>('/goods/catalog', { signal }) });
    const current = rows.find(r => r.id === selected);
    const src = current?.image_url || source;
    const running = rows.some(r => r.status === 'queued' || r.status === 'running');
    const uncertain = rows.some(r => r.status === 'unknown');
    const dirty = !guest && !saved && (!!work || busy || !!draft || (style !== null && style !== 'free'));
    const blocker = useBlocker(dirty);
    function dispose() {
        epoch.current++;
        uploadController.current?.abort();
        uploadController.current = null;
        if (sourceRef.current) {
            URL.revokeObjectURL(sourceRef.current);
            sourceRef.current = '';
        }
        const id = workRef.current;
        workRef.current = null;
        if (id && !savedRef.current && !guest)
            void abandon(id, true);
    }
    useEffect(() => {
        live.current = true;
        return () => {
            live.current = false;
            dispose();
            if (sourceRef.current)
                URL.revokeObjectURL(sourceRef.current);
        };
    }, []);
    useEffect(() => {
        if (blocker.state === 'blocked') {
            if (window.confirm(discardMessage)) {
                dispose();
                blocker.proceed();
            }
            else
                blocker.reset();
        }
    }, [blocker]);
    useEffect(() => {
        if (!dirty)
            return;
        const before = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        const logout = (e: Event) => {
            if (!window.confirm(discardMessage))
                e.preventDefault();
            else
                dispose();
        };
        const hide = () => dispose();
        const restore = (event: PageTransitionEvent) => {
            if (event.persisted) {
                setWork(null);
                setSource('');
                setRows([]);
                setSelected(null);
                setDraft('');
                setStyle(null);
                setStep(1);
                setBusy(false);
                setError('이전 작업은 화면을 떠나면서 폐기됐어요. 새로 시작해 주세요.');
                pending.current = null;
            }
        };
        window.addEventListener('pageshow', restore);
        window.addEventListener('beforeunload', before);
        window.addEventListener('pagehide', hide);
        window.addEventListener('mori:before-logout', logout);
        return () => {
            window.removeEventListener('pageshow', restore);
            window.removeEventListener('beforeunload', before);
            window.removeEventListener('pagehide', hide);
            window.removeEventListener('mori:before-logout', logout);
        };
    }, [dirty]);
    useEffect(() => {
        if (!work || saved)
            return;
        let closed = false;
        let timer: number;
        const restoreController = new AbortController();
        const poll = async () => {
            try {
                const data = await api<{
                    revisions: GoodsRevision[];
                    has_source?: boolean;
                    remaining_generations?: number | null;
                }>(`/goods/work/${work}`, { signal: restoreController.signal });
                if (!closed) {
                    if (data.has_source && !sourceRef.current) {
                        const url = await loadSourcePreview(work, restoreController.signal);
                        if (closed)
                            URL.revokeObjectURL(url);
                        else {
                            sourceRef.current = url;
                            setSource(url);
                        }
                    }
                    if (closed)
                        return;
                    if (data.remaining_generations !== undefined)
                        setRemaining(data.remaining_generations);
                    if (restoring.current && data.revisions.length) {
                        restoring.current = false;
                    if (!resume)
                        setStep(2);
                    const restored = data.revisions.find(r => r.id === resume?.revision_id) ?? data.revisions.at(-1);
                    const last = restored?.style;
                        if (last && STYLE_IDS.includes(last as StyleId))
                            setStyle(last as StyleId);
                    if (!resume)
                        setProduct(restored?.product ?? 'keyring');
                    }
                    const accepted = data.revisions.find(r => r.request_key === pending.current?.key);
                    if (accepted) {
                        pending.current = null;
                        setSelected(accepted.id);
                        setDraft('');
                    }
                    setRows(data.revisions);
                    if (!selectionTouched.current) setSelected(old => old ?? [...data.revisions].reverse().find(r => r.status === 'ready')?.id ?? null);
                }
            }
            catch (e) {
                if (!closed)
                    setError(errorText(e));
            }
            finally {
                if (!closed)
                    timer = window.setTimeout(poll, 2000);
            }
        };
        void poll();
        return () => {
            closed = true;
            restoreController.abort();
            clearTimeout(timer);
        };
    }, [work, saved]);
    async function upload(file?: File) {
        if (!file || busy || running)
            return;
        setError('');
        setBusy(true);
        const token = epoch.current;
        const controller = new AbortController();
        uploadController.current = controller;
        const signal = controller.signal;
        let candidate: string | null = null;
        let candidatePreview = '';
        try {
            await ensureConsent();
            const id = await replacePhoto(!!work, () => window.confirm('사진을 바꾸면 현재 사진과 생성한 시안, 대화 내역, 고리 위치 설정이 삭제됩니다. 새 사진으로 시작할까요?'), async () => {
                const prepared = await prepareGoodsSource(file, signal);
                // Keep the bounded create response alive so disposal can clean up its ID
                // even when the screen leaves after the server commits the empty work.
                candidate = (await api<{
                    id: string;
                }>('/goods/work', { method: 'POST', body: {}, key: crypto.randomUUID() })).id;
                signal.throwIfAborted();
                await uploadSource(candidate, prepared, signal);
                candidatePreview = await loadSourcePreview(candidate, signal);
                signal.throwIfAborted();
                if (!live.current || epoch.current !== token)
                    throw new DOMException('작업이 종료되었습니다.', 'AbortError');
                return candidate;
            }, async () => {
                signal.throwIfAborted();
                if (workRef.current)
                    await abandon(workRef.current);
            });
            if (!id)
                return;
            if (!live.current || epoch.current !== token) {
                void abandon(id);
                return;
            }
            workRef.current = id;
            setWork(id);
            candidate = null;
            if (sourceRef.current)
                URL.revokeObjectURL(sourceRef.current);
            sourceRef.current = candidatePreview;
            candidatePreview = '';
            setSource(sourceRef.current);
            setSourceAttached(true);
            selectionTouched.current=false;
            setRows([]);
            setSelected(null);
            if (work)
                setDraft('');
            setPreview(null);
            setPlacement({ holeX: .5, holeY: 0, widthMm: 50 });
            pending.current = null;
        }
        catch (e) {
            if (live.current && epoch.current === token)
                setError(errorText(e));
        }
        finally {
            if (candidate)
                void abandon(candidate);
            if (candidatePreview)
                URL.revokeObjectURL(candidatePreview);
            if (uploadController.current === controller)
                uploadController.current = null;
            if (live.current && epoch.current === token)
                setBusy(false);
        }
    }
    async function generate() {
        if ((!draft.trim() && (!sourceRef.current || !sourceAttached || selected)) || busy || running || uncertain || remaining === 0)
            return;
        const token = epoch.current;
        setBusy(true);
        setError('');
        const body = { product, style: style ?? 'free', message: draft.trim(), parent_id: generationParent(rows, selected), use_source: !!sourceRef.current && sourceAttached };
        const serialized = JSON.stringify(body);
        if (pending.current && pending.current.body !== serialized) {
            setError('앞선 요청 결과를 확인한 뒤 내용을 바꿔 주세요.');
            setBusy(false);
            return;
        }
        pending.current ??= { body: serialized, key: crypto.randomUUID() };
        try {
            await ensureConsent();
            let target = work;
            if (!target) {
                target = (await api<{
                    id: string;
                }>('/goods/work', { method: 'POST', body: {}, key: createIntent.current })).id;
                if (!live.current || epoch.current !== token) {
                    if (!guest)
                        void abandon(target);
                    return;
                }
                workRef.current = target;
                setWork(target);
            }
            const result = await api<{
                id: string;
            }>(`/goods/work/${target}/revisions`, { method: 'POST', body, key: pending.current.key });
            if (!live.current || epoch.current !== token)
                return;
            pending.current = null;
            setDraft('');
            setSelected(result.id);
            setStep(2);
            const state = await api<{
                revisions: GoodsRevision[];
            }>(`/goods/work/${target}`);
            if (live.current && epoch.current === token)
                setRows(state.revisions);
        }
        catch (e) {
            if (live.current && epoch.current === token)
                setError(errorText(e));
        }
        finally {
            if (live.current && epoch.current === token)
                setBusy(false);
        }
    }
    async function finish() {
        if (!work || !current || busy)
            return;
        if (guest) {
            rememberGoodsSave({ work_id: work, revision_id: current.id, placement, product });
            setShowLogin(true);
            return;
        }
        const token = epoch.current;
        setBusy(true);
        setError('');
        try {
            const result = await api<GoodsDesign>(`/goods/work/${work}/complete`, { method: 'POST', body: { revision_id: current.id, placement, product } });
            if (!live.current || epoch.current !== token)
                return;
            savedRef.current = true;
            forgetGoodsSave();
            setSaved(result);
        }
        catch (e) {
            if (live.current && epoch.current === token)
                setError(errorText(e));
        }
        finally {
            if (live.current && epoch.current === token)
                setBusy(false);
        }
    }
    async function newConversation() {
        if (busy || running)
            return;
        if ((work || draft) && !saved && !window.confirm('새 대화를 시작할까요? 현재 대화와 저장하지 않은 시안은 지워집니다.'))
            return;
        const token = epoch.current;
        setBusy(true);
        setError('');
        try {
            if (work && !saved)
                await abandon(work);
            if (!live.current || epoch.current !== token)
                return;
            uploadController.current?.abort();
            if (sourceRef.current)
                URL.revokeObjectURL(sourceRef.current);
            sourceRef.current = '';
            workRef.current = null;
            savedRef.current = false;
            pending.current = null;
            createIntent.current = crypto.randomUUID();
            forgetGoodsSave();
            setWork(null);
            setSource('');
            setSourceAttached(true);
            selectionTouched.current=false;
            setRows([]);
            setSelected(null);
            setDraft('');
            setStyle('free');
            setStep(1);
            setSaved(null);
            setPreview(null);
            setShowLogin(false);
            setPlacement({ holeX: .5, holeY: 0, widthMm: 50 });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        catch (e) {
            if (live.current && epoch.current === token)
                setError(errorText(e));
        }
        finally {
            if (live.current && epoch.current === token)
                setBusy(false);
        }
    }
    function choose(id: string | null) {
        selectionTouched.current=true;
        if (id !== selected) {
            setSelected(id);
            setPreview(null);
            setPlacement({ holeX: .5, holeY: 0, widthMm: 50 });
        }
    }
    function openPreview(id: string) {
        choose(id);
        setStep(3);
    }
    useEffect(() => {
        if (rows.length)
            tail.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, [rows.length, rows.map(r => r.status).join(':')]);
    const ready = !!current?.image_url && current.status === 'ready' && preview?.status === 'ready' && preview.key === previewKey({ src, product, placement });
    return { product, productLabel, loginBusy, setLoginBusy, showLogin, setShowLogin, agreed, setAgreed, remaining, step, setStep, style, setStyle, work, source, sourceAttached, setSourceAttached, selected, draft, setDraft, rows, busy, error, saved, placement, setPlacement, preview, tail, fileInput, pending, catalog, current, src, running, uncertain, ready, upload, generate, finish, newConversation, choose, openPreview, setProduct, setPreview };
}
