"""Reproducible design walkthroughs, not measured human behaviour or upload tests.

432 structural variants x 12 scripted tasks. No quality score or made-up seconds.
Run: python3 docs/ux/upload-flow/explore.py
"""
from itertools import product
from pathlib import Path
import csv
import json

OUT = Path(__file__).resolve().parent
AXES = {
    'entry': ['direct', 'intro', 'wizard', 'chat', 'auto_picker', 'source_choice'],
    'selection': ['grid', 'strip', 'list'],
    'send': ['automatic', 'one_send', 'review_then_send'],
    'progress': ['in_place', 'blocking'],
    'completion': ['same_gallery', 'separate_done'],
    'recovery': ['per_file', 'restart_batch'],
}
LABELS = {
    'direct': '바로 사진 추가', 'intro': '소개 후 시작', 'wizard': '단계 안내',
    'chat': '대화 안내', 'auto_picker': '진입 즉시 선택기', 'source_choice': '가져올 곳 선택',
    'grid': '사진 격자', 'strip': '가로 사진 띠', 'list': '파일 목록',
    'automatic': '선택 즉시 전송', 'one_send': '보내기 한 번', 'review_then_send': '별도 검토 후 전송',
    'in_place': '같은 화면 진행', 'blocking': '전송 전용 화면',
    'same_gallery': '저장된 격자 유지', 'separate_done': '별도 완료 화면',
    'per_file': '남은 파일만 복구', 'restart_batch': '묶음 전체 다시 선택',
}
TASKS = [
    ('normal_1', 1), ('normal_12', 12), ('normal_20', 20),
    ('cancel_picker', 0), ('wrong_photo', 12), ('add_more', 12),
    ('over_capacity_21', 21), ('offline_return', 20), ('one_bad_photo', 20),
    ('return_with_saved_8', 12), ('duplicate_send', 20), ('browser_restart', 20),
]
ENTRY_ACTIONS = {'direct': ['사진 추가'], 'intro': ['시작하기', '사진 추가'],
                 'wizard': ['시작하기', '다음', '사진 추가'], 'chat': ['사진 보낼게요', '사진 추가'],
                 'auto_picker': [], 'source_choice': ['사진 가져오기', '휴대폰 사진']}


def walkthrough(v, task, n):
    """Site actions exclude OS picker opening UI, file taps, and OS Done.

    Universal safety rules are shared; they are not credited to a visual design.
    No actual network/codec/background behaviour is inferred from this model.
    """
    actions = list(ENTRY_ACTIONS[v['entry']])
    states = ['entry', 'os_picker']
    unresolved = []
    if v['entry'] == 'auto_picker':
        unresolved.append('진입 자동 선택기는 사용자 동작 제한/맥락 상실 검증 필요')
    if task == 'cancel_picker':
        return dict(actions=actions, states=states+['entry'], before_send_review=True,
                    forced_reselection=0, unresolved=unresolved)
    states.append('selection')
    if task == 'over_capacity_21':
        states.append('over_capacity_keep_all_21')
        actions.append('사진 1장 선택 해제')
        n = 20
    if task == 'wrong_photo':
        if v['send'] == 'automatic':
            states += ['sending_unintended_photo', 'saved']
            actions += ['저장된 사진 관리 열기', '잘못 보낸 사진 삭제', '삭제 확인']
        else:
            actions.append('잘못 고른 사진 선택 해제')
    if v['send'] == 'one_send':
        actions.append('N장 보내기')
    elif v['send'] == 'review_then_send':
        actions += ['다음', '보내기']
        states.append('review')
    states.append('sending')
    if v['progress'] == 'blocking':
        states.append('transfer_only_surface')
    reselection = 0
    if task in ['offline_return', 'one_bad_photo']:
        states += ['partial_saved', 'automatic_retry']
        if v['recovery'] == 'restart_batch':
            actions += ['다시 사진 고르기']
            reselection = n
            states.append('os_picker_again')
            if v['send'] != 'automatic':
                actions.append('다시 보내기')
        elif task == 'one_bad_photo':
            actions.append('남은 1장 다시 시도')
            states.append('file_specific_attention')
        else:
            states.append('resume_remaining_on_online')
    if task == 'add_more':
        states += ['saved', 'os_picker_again']
        actions.append('사진 더 담기')
        if v['send'] == 'one_send':
            actions.append('추가 사진 보내기')
        elif v['send'] == 'review_then_send':
            actions += ['추가 사진 다음', '추가 사진 보내기']
    if task == 'duplicate_send':
        states.append('same_request_key_no_duplicate_required')
    if task == 'browser_restart':
        states.append('reload_server_saved_only')
        unresolved.append('탭 메모리의 미전송 파일은 재선택 필요; 종료 후 자동 복원 미구현')
    states.append('saved')
    if v['completion'] == 'separate_done':
        states.append('done_surface')
        actions.append('사진 목록으로')
    states.append('gallery')
    return dict(actions=actions, states=states,
                before_send_review=v['send'] != 'automatic',
                forced_reselection=reselection, unresolved=unresolved)


def screens(v):
    """Every variant has six composed wireframe states, including exceptional states."""
    return {
        'entry': {'structure': v['entry'], 'primary': '사진 고르기', 'limit': '최대 20장'},
        'selection': {'structure': v['selection'], 'primary': v['send'], 'count': 12},
        'sending': {'structure': v['progress'], 'count': '8 / 12장 저장', 'no_fake_percent': True},
        'saved': {'structure': v['completion'], 'count': '12장 저장됨', 'optional_add': True},
        'partial_failure': {'structure': v['recovery'], 'saved': 11, 'attention': 1},
        'over_capacity': {'structure': v['selection'], 'selected': 21, 'keep_all': True,
                          'primary': '사진 1장 선택 해제', 'automatic_drop': False},
    }


def main():
    variants, traces, rows = [], [], []
    for i, values in enumerate(product(*AXES.values()), 1):
        v = dict(zip(AXES, values))
        v['id'] = f'U{i:03}'
        v['label'] = ' · '.join(LABELS[x] for x in values)
        v['screens'] = screens(v)
        variants.append(v)
        task_runs = []
        for task, n in TASKS:
            result = walkthrough(v, task, n)
            traces.append(dict(variant=v['id'], task=task, **result))
            task_runs.append((task, result))
        normal = dict(task_runs)['normal_20']
        rows.append(dict(id=v['id'], **{k:v[k] for k in AXES},
                         normal_site_actions=len(normal['actions']),
                         before_send_review=normal['before_send_review'],
                         offline_reselect=dict(task_runs)['offline_return']['forced_reselection'],
                         readable_photo_slots={'grid':9, 'strip':3, 'list':4}[v['selection']],
                         label=v['label']))
    gate_stages = [('all', lambda v: True),
                   ('no_unnecessary_entry', lambda v:v['entry']=='direct'),
                   ('keep_saved_on_failure', lambda v:v['entry']=='direct' and v['recovery']=='per_file'),
                   ('stay_in_context', lambda v:v['entry']=='direct' and v['recovery']=='per_file' and v['progress']=='in_place'),
                   ('no_done_gate', lambda v:v['entry']=='direct' and v['recovery']=='per_file' and v['progress']=='in_place' and v['completion']=='same_gallery')]
    shortlist = [v for v in variants if gate_stages[-1][1](v)]
    recommended = next(v for v in shortlist if v['selection']=='grid' and v['send']=='one_send')
    summary = dict(kind='deterministic_design_walkthrough_not_user_research',
                   variant_count=len(variants), composed_states=len(variants)*6,
                   scenario_count=len(TASKS), walkthrough_count=len(traces),
                   gates=[dict(name=name,count=sum(fn(v) for v in variants)) for name,fn in gate_stages],
                   recommended=recommended['id'],
                   final_nine=[v['id'] for v in shortlist],
                   caution=['색상만 바꾼 432개가 아닌 구조 축 조합. 432개 모두를 사람이 실사용한 결과가 아님.',
                            '격자 슬롯 9/띠 3/목록 4는 모델의 화면 예산 가정이며 기기 측정값이 아님.',
                            '정성 점수, 완료 시간, 성공률을 생성하지 않음. 선택한 설계 기준으로 후보를 거른 것.',
                            '브라우저 종료/대량 업로드/코덱 안정성은 화면 탐색으로 입증 불가.'])
    assert len(variants)==432 and len(traces)==5184 and len(shortlist)==9
    assert len({tuple(v[k] for k in AXES) for v in variants})==432
    assert all(not(v['screens']['over_capacity']['automatic_drop']) for v in variants)
    assert all(t['forced_reselection']==0 for t in traces if next(v for v in variants if v['id']==t['variant'])['recovery']=='per_file')
    for filename, data in [('variants.json',variants),('walkthroughs.json',traces),('summary.json',summary)]:
        (OUT/filename).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    with (OUT/'variants.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n');writer.writeheader();writer.writerows(rows)
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
