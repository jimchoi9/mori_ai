# Mori NFC reader selected reuse

Source: user-provided mori-memory-nfc Site, dist/assets/book.js and page-flip.js.
Source commit is recorded in docs/재사용조사.md. The original Site is read-only.
page-flip.js preserves the accompanying MIT license (Copyright 2020 Nodlik).
Adaptations: cancel renderer RAF on destroy; return book cleanup; dispose listeners/timers;
keyboard navigation. Static personal media, Site credentials, music, and deployment configuration
are not copied. The application supplies its own album photos/captions and authorized BGM.

The shared reader optionally appends an application-supplied back cover, restores a page
index, and returns to the first photo. The application's bookEnding module owns its
text/actions and numeric history position; no original Site account or private media is reused.
