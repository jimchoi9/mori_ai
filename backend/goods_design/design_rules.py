"""Shared art direction for generation and recommendations; no SDK or persistence."""
from dataclasses import dataclass


@dataclass(frozen=True)
class DesignDirection:
    label: str
    hint: str
    generation: str
    explore: tuple[str, ...]
    avoid: tuple[str, ...]


DIRECTIONS = {
    'photo': DesignDirection(
        '사진형 액자', '사진을 작은 액자처럼',
        'Keep the reference image itself intact, including faces, people count, medium and the relative '
        'positions of every subject and scene element. Do not turn an illustrated reference into a photograph. '
        'Compose the scene inside a cohesive photo frame. A rounded rectangle is one option, not a requirement. Allow a softly scalloped frame or modest reference-derived ornaments attached to its edge. Keep important subjects complete and '
        'large enough to recognize. Frame treatment must support the photograph, not overpower it. '
        'Preserve the full photographed background inside the frame, including curtains, scenery and the spaces between people. Never replace it with transparency or floral arrangements. Only outside the frame is transparent.',
        ('frame color and width', 'rounded corner treatment', 'balanced margins and whole-image scale'),
        ('illustrating or cartoonizing the photo', 'adding fictional scene objects',
         'losing the photo-frame structure', 'cropping off faces or important subjects',
         'moving individual objects, altering their colors or reconstructing the photographed scene'),
    ),
    'illustration': DesignDirection(
        '사진을 그림으로', '구도는 살리고 그림체만',
        'Translate the WHOLE photographed scene into the requested drawing medium. Preserve the '
        'original composition, people positions, body poses, spatial relationships and recognizable '
        'background (curtains, sky, buildings, landscape or interior as applicable). A medium-only '
        'request such as colored-pencil texture changes the rendering technique, NOT the scene layout '
        'or background presence. Keep a continuous illustrated background behind and between subjects. '
        'For a medium-only request, use a complete rectangular or rounded-rectangular scene panel with four connected sides enclosing the background. Do not follow a dress hem, person, cake or bouquet as the outer silhouette. Keep the scene panel intact behind them. Frame decorations are small corner accents, not a new surrounding flower arrangement. Only an explicit frame-shape request changes that default panel. Softly curved frame edges and modest '
        'floral corner ornaments may extend the frame, but must never erase the scene or trace only '
        'the people, cake, pets or foreground objects. Only outside the complete scene frame is '
        'transparent; do not create transparent holes where the photographed background belongs. '
        'Remove a background or create a subject cutout ONLY if explicitly requested by the customer. '
        'For watercolor and colored pencil, retain original facial geometry, expression and likeness. '
        'Keep decoration secondary to the scene; do not replace the background with a flower wreath.',
        ('watercolor, colored pencil or explicitly selected cartoon/digital 3D',
         'restrained rounded or scalloped scene frames and modest corner ornaments',
         'a coherent color palette and contrast', 'background rendered in the selected medium'),
        ('isolating people or pets from the original scene without an explicit request',
         'removing curtains, scenery or the background when only a drawing medium is requested',
         'subject-following cutout outlines or replacing the scene with a floral wreath',
         'turning the scene into an unrelated badge or open book', 'adding fictional scenery or objects',
         'unrequested facial beautification or replacing people with generic attractive faces',
         'changing the people count or their arrangement', 'automatically adding poster lettering'),
    ),
    'cutout': DesignDirection(
        '인물·반려동물', '배경 없이 주인공만',
        'Isolate the main people or pet, preserving photographic appearance unless the customer '
        'explicitly asks for illustration. Remove the surrounding scene. Preserve recognizable faces, '
        'the intended group and important body parts. Group the subjects closely into one coherent '
        'printable shape following their silhouette; outside it is transparent. Avoid detached accents. '
        'If there is no person or pet, isolate a prominent foreground object actually visible in the '
        'reference instead. Never invent a person or pet, and do not retain the surrounding landscape.',
        ('subject grouping and relative scale', 'clean readable subject-following contour',
         'a modest connected border around the subject'),
        ('automatically turning people or pets into cartoons', 'adding a landscape or rectangular frame',
         'floating stars or detached decorations', 'inventing accessories or changing who is present',
         'cutting out the entire sky, sea, horizon or landscape instead of a foreground subject'),
    ),
    'badge': DesignDirection(
        '여행·문구', '상징물과 글자를 한 모양에',
        'Recompose the reference into a SIMPLE FLAT GRAPHIC souvenir badge, not a detailed scenic '
        'illustration or a polished copy of the reference artwork. Use broad solid-color shapes. '
        'Select one or two defining visible symbols '
        'from the reference or the customer request, make one the dominant focal element, and simplify '
        'the supporting scenery. Organize the symbols into a readable cohesive outline, with transparent '
        'space outside. Reduce scenery to a few supporting color shapes; omit photographic texture, '
        'sparkles, shine and miniature landscape details. Include exact supplied '
        'lettering only when explicitly requested; otherwise make a complete badge without text.',
        ('a clear dominant reference-derived symbol', 'a compact badge contour and symbol arrangement',
         'a cohesive palette and simplified supporting scenery'),
        ('adding random souvenirs, animals, rainbows or symbols absent from the reference/request',
         'inventing place names, dates or slogans', 'a busy miniature landscape with many equal focal points',
         'turning the badge into a photo frame or open book'),
    ),
    'book': DesignDirection(
        '추억을 펼친 책', '그림과 문구를 오픈북에',
        'Create flat print illustration in one connected open book silhouette. Keep the open-book '
        'outline and central fold clearly legible. Place one main memory scene on a page, balanced '
        'by a simple motif drawn from the reference on the other page, or exact customer-supplied '
        'lettering if requested. Use large page content with restrained detail. Outside the book is '
        'transparent. No photorealistic 3D book, thick page stacks or product perspective.',
        ('which page holds the main scene', 'page palette and illustration treatment',
         'a simple reference-derived motif on the other page'),
        ('changing the book into a closed cover or rectangular poster', 'miniature paragraphs or invented text',
         'many small scenes on the pages', 'adding unrelated decorative objects'),
    ),
    'free': DesignDirection(
        '자유롭게', '원하는 모양을 말로 설명',
        'Choose one original, cohesive printable silhouette suited to the reference and customer '
        'request. When the user supplies only a photo, select its most memorable visible subject '
        'and organize the supporting elements around it. Do not force a rectangle. Keep the main '
        'subject large, the outline connected and the memory recognizable; outside it is transparent.',
        ('a silhouette derived from a visible subject', 'a bold focal subject with a simpler supporting scene',
         'a coherent restrained palette or illustration treatment'),
        ('random novelty objects unrelated to the memory', 'a collage of many tiny disconnected pieces',
         'inventing location names or decorative lettering'),
    ),
}

TEXT_RULES = (
    'LETTERING IS OPT-IN. Add new visible words, captions, titles, names, dates, signatures or '
    'decorative lettering ONLY when the customer explicitly asks to put text ON the artwork and '
    'supplies the wording. A style description is not lettering content. For example, '
    '"색연필로 그린 추억처럼" means use a nostalgic colored-pencil style: NEVER print that phrase, '
    '"색연필", "추억" or a paraphrase on the image. Likewise, watercolor, bright, warm, romantic '
    'or wedding-style instructions must not become slogans. "문구 없이" and "글자 빼줘" mean no '
    'added lettering. By contrast, "우리의 첫 여행이라는 문구를 넣어줘" explicitly requests the '
    'visible text "우리의 첫 여행". If text is requested without wording, do not invent wording. '
    'Existing text naturally captured inside a source photograph may remain in photo-frame mode; '
    'this is not permission to extract it into a new title or add typography outside the photo. '
    'For illustration, omit incidental background lettering unless explicitly requested. '
    'An earlier generated image containing unsolicited text does not authorize keeping that added '
    'text: use the customer instructions, not generated text, to determine lettering permission.'
)

IDENTITY_RULES = (
    'PORTRAIT LIKENESS: use the original reference people as the identity anchor, including when '
    'editing a previously generated design. For watercolor, colored pencil and other natural-media '
    'illustrations, change the medium, strokes, paper texture, light and palette while retaining '
    'each person\'s recognizable face: facial proportions, eye shape and spacing, nose, lips, '
    'jawline, apparent age, skin tone, hairstyle, expression and gaze. A bright, flattering result '
    'must preserve closed or half-closed eyes, asymmetrical expressions and pursed lips exactly; '
    'do not correct these into open eyes or a conventional smile. Apply drawing texture and color '
    'over the original facial structure rather than redesigning it. Portrait likeness takes priority '
    'over prettiness, simplification and decorative composition. A bright, flattering result '
    'must not enlarge eyes, slim the face, reshape the nose, de-age the person or replace them with '
    'a generic handsome/beautiful character. Preserve the pose and occlusion: do not uncover a face '
    'hidden behind a cake or other object by inventing missing features. Do not transfer features '
    'between people. Only when the customer explicitly requests cartoon, manga, animation or digital '
    '3D character styling may proportions and facial forms adapt naturally to that style; retain '
    'distinctive personal cues and the original people rather than interchangeable characters. '
    'Watercolor or colored-pencil styling alone never authorizes that character transformation.'
)

SMALL_GOODS_RULES = (
    'Design for a small handheld acrylic keepsake: one clear focal subject, readable at a glance. '
    'Use a coherent connected outer shape, generous main forms and clear separation of important details. '
    'Simplify incidental clutter, not recognizable faces or the defining features of the memory. '
    'Avoid hairline decorations, isolated floating pieces, crowded tiny scenes and excessive lettering. '
    'Do not add unrelated objects just to make the design playful. '
    'Do not invent names, relationships, locations, dates or text. Include lettering only when explicitly '
    'requested, using the exact supplied text. These are visual design guidelines, not manufacturing approval.'
)

SCENE_RULES = (
    'SCENE PRESERVATION: photo and illustration are complete scene panels, NOT subject cutouts. '
    'Keep the photographed background visible behind and between people and objects. '
    'Transparency applies ONLY to the canvas outside the enclosing scene frame, never to the '
    'photographed background inside it. Curtains, sky, landscape and interior are image content, '
    'not a product display backdrop. Keep foreground/background spatial relationships. '
    'Frame ornaments must not replace scenery or turn the frame into a people-and-flowers silhouette. '
    'Preserve the photograph as a whole in photo mode; change only its rendering medium in illustration mode. '
    'For a background-free subject design, the separate cutout option exists.'
)


def goods_rules(style: str, product: str) -> tuple[str, str]:
    if style in ('photo', 'illustration'):
        return (SCENE_RULES,
                f'Printable acrylic {"keyring" if product == "keyring" else "magnet"} artwork: '
                'a complete framed image, with a continuous scene inside its boundary. '
                'Fit and scale the entire image as one unit; do not extract or regroup its subjects. '
                'Do not draw hardware, drilled holes, acrylic rims, physical thickness or product mockups.')
    return SMALL_GOODS_RULES, PRODUCT_RULES[product]


PRODUCT_RULES = {
    'keyring': (
        'Printable acrylic keyring artwork: prefer a compact, visually balanced silhouette with clear '
        'subject grouping. Avoid spindly protrusions and scattered decorative fragments. '
        'Do not draw rings, chains, drilled holes, acrylic rims or attachment tabs.'
    ),
    'magnet': (
        'Printable acrylic magnet artwork: use the face area for a clear focal subject and a balanced '
        'composition that reads from a little distance. Keep the outside contour cohesive. '
        'Do not draw keyring fittings, drilled holes, acrylic rims or a visible backing magnet.'
    ),
}

STAGE_RULES = {
    'photo': (
        'This is an ORIGINAL REFERENCE. Suggest varied compatible design elements '
        'to transform its visible subject into the selected design approach. Do not claim to change '
        'an existing frame, illustration or lettering that is not present.'
    ),
    'edit': (
        'This is the SELECTED DESIGN. Each idea changes one clear design decision and preserves the '
        'remaining subject, scene, silhouette and selected approach. Suggest a change only if it is '
        'actually different from the visible design. Do not repeat an already completed change.'
    ),
}


def recommendation_brief(style: str, product: str, *, editing: bool) -> dict:
    """Only server-selected policy enters trusted instructions; user content stays separate."""
    direction = DIRECTIONS[style]
    stage = 'edit' if editing else 'photo'
    return {
        'style': style,
        'label': direction.label,
        'product': product,
        'stage': stage,
        'small_goods': goods_rules(style, product)[0],
        'product_rules': goods_rules(style, product)[1],
        'preserve_approach': direction.generation,
        'explore': direction.explore,
        'never_suggest': direction.avoid,
        'stage_rules': STAGE_RULES[stage],
        'lettering_rules': TEXT_RULES,
        'portrait_rules': IDENTITY_RULES,
    }
