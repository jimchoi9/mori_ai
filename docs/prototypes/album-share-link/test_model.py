"""Interaction/state checks for the synthetic UX trial, not product API acceptance."""
import unittest
from model import DemoModel,DemoError,SCENARIOS

class ShareModelTest(unittest.TestCase):
 def setUp(self):self.m=DemoModel()
 def issued(self,scenario='ready',mode='b'):
  self.m.setup(mode,scenario);return self.m.issue(mode)
 def enter(self,a):return self.m.enter(a['link'].split('/')[2].split('#')[0],a['link'].split('#key=')[1])
 def test_preview_does_not_mint_public_link(self):
  book=self.m.read_book(self.m.variants['b'],owner=True)
  self.assertEqual(book['state'],'ready');self.assertIsNone(self.m.summary('b')['link'])
  self.assertTrue(self.m.media(book['session_token'],book['pages'][0]['id']))
 def test_repeat_issuance_is_one_stable_link_for_each_variant(self):
  for mode in 'abc':
   a=self.issued(mode=mode)
   for _ in range(10):self.assertEqual(self.m.issue(mode)['link'],a['link'])
   self.assertEqual(self.m.summary(mode)['issues'],1)
 def test_first_issue_failure_never_claims_a_link(self):
  self.m.setup('b','create_failure')
  with self.assertRaises(DemoError):self.m.issue('b')
  self.assertIsNone(self.m.summary('b')['link']);self.assertEqual(self.m.summary('b')['issues'],0)
  self.assertEqual(self.m.issue('b')['issues'],1)
 def test_response_lost_then_retry_keeps_exact_same_key(self):
  self.m.setup('b','lost_reply')
  with self.assertRaises(DemoError):self.m.issue('b')
  before=self.m.summary('b');after=self.m.issue('b')
  self.assertEqual(before['link'],after['link']);self.assertEqual(after['issues'],1)
 def test_empty_and_uploading_links_work_later_without_rewriting_nfc(self):
  for case in ('empty','pending'):
   a=self.issued(case);self.assertEqual(self.enter(a)['state'],'preparing')
   self.m.update('b');self.assertEqual(self.m.summary('b')['link'],a['link'])
   self.assertEqual(self.enter(a)['state'],'ready')
 def test_all_48_photos_remain_in_order_with_missing_caption(self):
  a=self.issued('caption_missing');book=self.enter(a)
  self.assertEqual(len(book['pages']),48);self.assertEqual(book['pages'][23]['text'],'')
  self.assertEqual([p['id'] for p in book['pages']],[p['id'] for p in a['photos']])
 def test_pause_resume_preserves_link_and_original_downloaded_payload(self):
  a=self.issued();book=self.enter(a);photo=book['pages'][0]
  self.m.active('b',False);self.assertEqual(self.enter(a)['state'],'paused')
  with self.assertRaises(DemoError):self.m.media(book['session_token'],photo['id'])
  self.m.active('b',True);self.assertEqual(self.m.summary('b')['link'],a['link'])
  self.assertEqual(self.enter(a)['state'],'ready');self.assertTrue(photo['text'])
 def test_next_entry_has_updates_but_current_book_is_pinned(self):
  a=self.issued();before=self.enter(a);text=before['pages'][0]['text']
  self.m.update('b');after=self.enter(a)
  self.assertEqual(before['pages'][0]['text'],text);self.assertNotEqual(after['pages'][0]['text'],text)
  self.assertEqual(self.m.summary('b')['link'],a['link'])
 def test_unsaved_text_never_published_when_save_fails(self):
  self.m.setup('b','save_failure')
  with self.assertRaises(DemoError):self.m.issue('b')
  with self.assertRaises(DemoError):self.m.prepare('b')
  self.assertIsNone(self.m.summary('b')['link'])
  self.m.prepare('b');a=self.m.issue('b');self.assertIn('수정한 글귀',self.enter(a)['pages'][0]['text'])
 def test_wrong_key_and_foreign_media_are_rejected(self):
  a=self.issued();book=self.enter(a)
  for bad in ('wrong',None,[],{'key':'x'},'한글'*20):
   with self.assertRaises(DemoError):self.m.enter(self.m.variants['b'].tag,bad)
  other=self.issued(mode='c');foreign=other['photos'][0]['id']
  with self.assertRaises(DemoError):self.m.media(book['session_token'],foreign)
 def test_public_entry_excludes_owner_controls_and_other_albums(self):
  book=self.enter(self.issued())
  self.assertEqual(set(book),{'state','album_title','revision','session_token','pages'})
  self.assertEqual(set(book['pages'][0]),{'id','text','src'})
 def test_every_scenario_is_available_and_setup_does_not_affect_other_modes(self):
  for case in SCENARIOS:self.assertEqual(self.m.setup('b',case)['scenario'],case)
  self.assertEqual(self.m.summary('a')['scenario'],'ready')

if __name__=='__main__':unittest.main()
