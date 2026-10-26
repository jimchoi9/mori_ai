"""Versioned goods prompts adapted from pilot fb5a3418. No model or paid call policy."""
from dataclasses import dataclass
from backend.goods_design.design_rules import DIRECTIONS, PRODUCT_RULES, SMALL_GOODS_RULES, TEXT_RULES, IDENTITY_RULES, goods_rules, SCENE_RULES

PROFILE_VERSION = "goods-small-v13"

@dataclass(frozen=True)
class PromptSnapshot:
    version: str
    style_id: str
    prompt: str

def catalog() -> list[dict[str, str]]:
    return [{"id": key, "label": value.label, "hint": value.hint} for key, value in DIRECTIONS.items()]


def build_prompt(style_id: str, request: str, context: tuple[str, ...] = (), *, editing: bool = False, product: str = 'keyring') -> PromptSnapshot:
    if product not in ('keyring','magnet'):
        raise ValueError('Invalid product')
    if style_id not in DIRECTIONS or not isinstance(request, str) or not request.strip() or len(request) > 3000:
        raise ValueError("Invalid style or design request")
    if any(not isinstance(item, str) for item in context):
        raise ValueError("Invalid design context")
    scene = style_id in ('photo', 'illustration')
    small_rules, product_rules = goods_rules(style_id, product)
    base = (
        "OUTPUT: a flat 2D print design, the ink artwork ONLY, isolated on transparent alpha. "
        "Use the customer's reference images and request as subject matter for the selected approach. "
        "Preserve requested people count and recognizable features. "
        + ("Retain the meaningful scene inside a complete enclosing frame, " if scene else "Produce one cohesive connected silhouette, ") +
        "all artwork fully visible. No keychain hardware, drilled holes, acrylic rim or product mockup background. "
        "The region OUTSIDE the design must have a truly transparent alpha background. "
        "No cast shadow on a background, physical acrylic thickness, bevel or photorealistic product rendering. "
        + small_rules + "\nProduct: " + product_rules
        + "\nDesign approach: " + DIRECTIONS[style_id].generation
        + "\n" + TEXT_RULES + "\n" + IDENTITY_RULES
    )
    if editing:
        base += " The first image is the selected design: use it for layout, border and the intended design decisions. Other images, when present, are original photographic references and are the authority for identity, facial anatomy, expression and fine real-world details. Apply only the requested change, but reconstruct clean detail from the original reference rather than copying accumulated smudges, artificial skin patterns, repeated decorative noise or sharpening artifacts from generated images. Do not intensify texture with each edit. A change of drawing medium replaces the old medium; it is not an extra filter on top of it. Preserve existing composition and ornaments unless requested otherwise."
    else:
        base += (" This is a new design in the selected approach, not a product-photo retouch. "
                 "If a reference already shows a souvenir, do not copy its acrylic rim, shine, "
                 "cast shadow or display background into the output. For photo frames and illustration, "
                 "retain the defining original scene and likeness; choose the border independently of the drawing medium. "
                 "Only cutout, badge, book and free approaches may recompose according to their rules.")
    if context:
        base += "\nEarlier instructions from the selected branch (current request takes precedence):\n" + "\n".join(context)
    base += "\nCurrent customer request: " + request.strip()
    base += ("\nDeliver only the flat artwork. Outside the artwork boundary: alpha 0, no cast shadow. "
             "Final check: no added lettering without explicit text-placement permission; "
             "natural-media portraits must still look like the original people.")
    if scene:
        base += '\nFINAL SCENE CHECK: preserve the meaningful background and all intended subjects. Default to a plain rounded-rectangle panel. Use only conservative framing and tonal correction when useful; retain the original composition when uncertain. No unrequested decoration.'
    return PromptSnapshot(f'{PROFILE_VERSION}-{product}', style_id, base)
