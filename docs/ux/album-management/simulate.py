"""Deterministic navigation traces, NOT participants, usability scores, or timings.

Run from any directory. Counts only changes between upload and management views;
OS picker taps, photo edits and transport duration are intentionally not estimated.
"""
from pathlib import Path
import json
OUT=Path(__file__).resolve().parent
STRATEGIES=('upload_first','manage_first','mixed','adaptive')
CASES={
 'first_1':('empty',('send','inspect')),
 'first_12':('empty',('send','inspect')),
 'first_20':('empty',('send','inspect')),
 'send_only':('empty',('send',)),
 'cancel_selection':('empty',('cancel',)),
 'over_21':('empty',('over','deselect','send','inspect')),
 'offline':('empty',('send_partial','offline','resume','inspect')),
 'one_failed':('empty',('send_partial','retry_one','inspect')),
 'unsent_open_manage':('empty',('select','inspect','return_upload','send','inspect')),
 'return_unsent':('unsent',('send','inspect')),
 'return_uploading':('uploading',('resume','inspect')),
 'return_read':('saved',('inspect',)),
 'return_caption_edit':('saved',('edit_caption',)),
 'return_order':('saved',('reorder',)),
 'return_add':('saved',('add','send','inspect')),
 'return_add_twice':('saved',('add','send','inspect','add','send','inspect')),
 'return_delete':('saved',('delete',)),
 'return_after_restart':('saved',('inspect',)),
 'caption_pending':('saved',('inspect','caption_pending','edit_caption')),
 'caption_failure':('saved',('inspect','caption_error','retry_caption')),
 'caption_unsaved_add':('saved',('edit_caption','add','send','inspect')),
 'delete_last':('saved',('delete_last','add','send','inspect')),
 'two_tabs_conflict':('saved',('edit_caption','conflict','resolve')),
 'logout':('saved',('inspect','logout')),
 'nfc_during_prepare':('saved',('inspect','tag_nfc_preparing')),
 'published_return':('published',('inspect',)),
}
UPLOAD={'send','select','cancel','over','deselect','send_partial','offline','resume','retry_one','return_upload'}
MANAGE={'inspect','edit_caption','reorder','delete','delete_last','caption_pending','caption_error','retry_caption','conflict','resolve'}
def run(strategy,initial,events):
 view='combined' if strategy=='mixed' else 'upload' if strategy=='upload_first' or strategy=='adaptive' and initial in {'empty','unsent','uploading'} else 'manage'
 trace=[{'event':'enter','view':view}];switches=0;forced_empty_manage=initial=='empty' and view=='manage'
 for event in events:
  desired='upload' if event in UPLOAD or event=='add' else 'manage' if event in MANAGE else view
  if strategy=='mixed':desired='combined'
  if desired!=view:switches+=1;view=desired
  trace.append({'event':event,'view':view})
 return {'trace':trace,'view_switches':switches,'empty_manage_first':forced_empty_manage,
  'simultaneous_primary_tools':['attachments','send','ordered_photos','captions','finish'] if strategy=='mixed' else ['attachments','send'] if initial=='empty' else ['ordered_photos','captions','add'],
  'guards':{'no_switch_during_active_transfer':True,'keep_unsent_files_in_tab':True,'caption_edits_saved_or_guarded_before_leave':True,'publication_not_simulated':True}}
def main():
 traces=[{'strategy':s,'case':name,**run(s,initial,events)} for s in STRATEGIES for name,(initial,events) in CASES.items()]
 summary={'kind':'scripted_navigation_model_not_user_research','strategies':len(STRATEGIES),'cases':len(CASES),'traces':len(traces),'comparison':{s:{'first_send_only_switches':next(x['view_switches'] for x in traces if x['strategy']==s and x['case']=='send_only'),'first_send_inspect_switches':next(x['view_switches'] for x in traces if x['strategy']==s and x['case']=='first_12'),'return_read_switches':next(x['view_switches'] for x in traces if x['strategy']==s and x['case']=='return_read'),'return_add_inspect_switches':next(x['view_switches'] for x in traces if x['strategy']==s and x['case']=='return_add')} for s in STRATEGIES},'recommendation':'adaptive','limitations':['Event traces are designed assumptions, not observed user actions.','One combined view has fewer view switches; this model does not measure cognitive load or claim a statistical winner.','No timings, preference proportions, upload capacity or real-device performance are inferred.','Publication is automatic and editing is allowed without a period limit by the later user decision; this navigation model does not test either server policy.']}
 assert len(traces)==104
 assert summary['comparison']['adaptive']['first_send_only_switches']==0
 assert summary['comparison']['adaptive']['first_send_inspect_switches']==1
 assert summary['comparison']['adaptive']['return_read_switches']==0
 assert summary['comparison']['upload_first']['return_read_switches']==1
 assert all(x['view_switches']==0 for x in traces if x['strategy']=='mixed')
 for name,value in [('traces.json',traces),('summary.json',summary)]: (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(summary,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
