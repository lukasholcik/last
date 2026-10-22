# What existing last-design tools can teach us

This note collects useful examples for our tool, not a recommendation to buy a particular product.
You confirmed that 3DShoemaker, whose older interface is called ShoeLastMaker, is the plugin you had in mind.
Its measurement form is a useful reference for organising our inputs; the meaning of each control still needs checking.

The findings below distinguish three things:
- **Documentation:** what a product guide or page says it does.
- **Image observations:** what we could see in inspected product images and measurement diagrams.
- **Our suggestions:** ideas we could use, not claims about a vendor's features.

Images are linked at their source. No image files are stored in this project.

## 3DShoemaker / ShoeLastMaker

[Public introduction and guide](https://3dshoemaker.com/parametric-shoe-last-design-software-introduction-to-shoelastmaker/)

The guide describes building adjustable lasts from templates, importing a foot, and editing numbers.
It separates the body of the last from its toe template, which is useful when trying different toe shapes.
An imported external last can be a visual reference. That is not evidence that any imported mesh
can automatically become a fully adjustable last with all the template's controls.

The guide is not a complete list of every control. We have not verified automatic reshaping for heel elevation.
For our project, the existing wrong-size high-heel last remains excluded even as a starting reference.

### Image: foot and last numbers

[Build Last form](https://3dshoemaker.com/wp-content/uploads/2021/10/ShoeLastMaker-Build-Last-Form.jpg)

The image shows separate **Foot** and **Last** columns, with rows for:
- Length, Ball Girth, Instep Girth, Ball Width, and Heel Height.
- “Adapt” and “Auto” boxes.
- Length and width indices, plus right/left selection.
- Allowances for Medial/Lateral Ball Width and Medial/Lateral Heel Width.

Here, “girth” means distance around a region. “Medial” is the big-toe side; “lateral” is the little-toe side.
The useful lesson is to keep reference-foot numbers separate from chosen last numbers,
and allow the two sides to differ. The image alone does not explain what each checkbox calculates.

### Image: editing and rebuilding

[Control panel](https://3dshoemaker.com/wp-content/uploads/2021/10/Shoe-Last-Maker-Control-Panel.jpg)

Visible controls include Edit, Update, End Edit, Import Foot, Build, and Rebuild.
Layer names include LastSurfaces, LastCurves, LastDimensions, Insert, and Bottom.
There are also clipping-plane controls and a slider: these can help reveal parts hidden inside a 3D model.
This supports the idea of deliberate editing and updating, not a claim about how every edit is preserved.

### Image: curves around a 3D last

[Annotated 3DShoemaker view](https://3dshoemaker.com/wp-content/uploads/2023/03/3DShoemaker.jpg)

The blue last has curves resembling sections across its shape, a lower perimeter, and dimensions.
This suggests a useful way to think about the upper surface: a series of shapes along the length.
It does not prove which curves or points are editable, their names, or how many controls there are.

### Image: paired outline views

[Wall quadrants](https://3dshoemaker.com/wp-content/uploads/2022/05/Viewing-shoe-last-wall-quadrants-all-at-one-time.jpg)

The image shows paired side and top views, asymmetric outlines, dimensions, and “WALL QUADRANTS”.
It is useful evidence for seeing related views together and treating the sides separately.
It is not verified evidence of a bottom-profile editor.

## ICAD Last

[Product page](https://icad.inescopsolutions.com/icad-last/)

The page describes modifying digitized lasts, changing their shapes, and comparing them with feet.
This is a relevant comparison for adjustment tools, but not proof of our proposed from-numbers workflow.

### Image: joining shapes

[Join operation](https://icad.inescopsolutions.com/wp-content/uploads/2024/09/Icad_Last_01.png)

The image shows side, top, cross-section (labelled YZ), and 3D views, with plane lines, square endpoints, and arrows.
The panel shows Method: Planes, Distance in mm, Heights, Enlarge/Narrow, Lengthen/Shorter,
Inner/Outer, Use fix points, and Synchronize profiles.
This shows controls for a join operation; it does not prove ordinary curve-handle editing.

### Image: changing the ball region

[Rectification view](https://icad.inescopsolutions.com/wp-content/uploads/2024/09/Icad_Last_02.png)

A red ball curve and point markers appear in top and side views.
Labels include Ball curve, Sections, Vertical ball curve, and Perimeter (mm), shown changing from 251.1 to 253.1.
These are values visible in the vendor image, not proposed measurements for our examples.
Other labels include Featherline, Lock zone, Editable zone in red, and Constant zone in yellow.
The useful lesson is to show which region changes and which stays fixed.
The image does not establish how the software guarantees dimensions or resolves conflicting edits.

## Two other comparisons

- [Romans CAD 3D Last](https://www.romans-cad.com/en/3d-last-1): describes creating and modifying adjustable lasts
  from measurements or scans. The available product-level description does not explain its detailed controls.
- [Botcha last tools](https://docs.footwearkit.com/botcha/last/): describe grading existing geometry
  using length and ball measurements. Grading means changing size; full last generation is not verified here.

## Suggestions for our first top-outline version

These are **our proposed controls**, informed by the examples, not a list of documented vendor controls:
- Toe end and total length.
- Heel width.
- Position and width at the ball on the big-toe and little-toe sides.
- Positions through the narrower middle, often called the waist.
- Curves for narrowing, rounding, and shaping the toe.

Start with the outline from above, then the bottom in side view, then the upper surface.
The top-view outline is not necessarily the same as the bottom perimeter, sometimes called the featherline.
You chose the outer silhouette seen from above for the first experiment. The bottom perimeter remains separate.

After inspecting the images, the independent review recommended starting with meaningful locations
(heel, waist, ball, and toe) joined by curves, rather than arbitrary control points.
Separate side distances can determine total width; local curve adjustments shape the spaces between locations.
These are our modelling suggestions, not a reconstruction of the products' hidden algorithms.
The numeric SVG test is now implemented. The current app direction is browser-first, not interactive Blender editing.

Other useful ideas are separate reference/last values, asymmetric sides, paired views,
sections to help build the upper surface, clearly marked edited/fixed regions, and deliberate edit/update actions.
The two proposed dragging modes in the concept document are still unanswered; these examples do not settle that choice.

## What this research does not establish

Neither screenshots nor product descriptions give us exact point counts, an order of priority for conflicting dimensions,
automatic preservation of every number, or a rule linking the heel endpoint to the whole bottom curve.
We have not verified an automatic heel-deformation formula in these products.
Their features do not prove that a generated last will fit, and do not decide our measurement methods or allowances.
Use these examples to make our controls clearer, not to invent hidden guarantees.

## Measurement definitions checked for the next step

For every last-design choice, consult online evidence and label it as an established definition,
a vendor convention, or our assumption. A familiar label does not mean two tools measure the same thing.

**Vendor convention:** the [3DShoemaker measurement guide](https://3dshoemaker.com/measurements-in-shoe-last-maker/)
describes five primary measurements: length, ball girth, instep girth, ball width, and heel height.
They work with toe, body, insert, and bottom templates: five numbers alone do not uniquely determine a shape.
See its [primary-measurements image](https://3dshoemaker.com/wp-content/uploads/2022/05/Primary-Measurements-in-Shoe-Last-Maker.jpg)
and [combined measurement diagram](https://3dshoemaker.com/wp-content/uploads/2022/05/Shoe-Last-Maker-Measurements.png).
Read each control's full functional description, not just its label:
- Its curved-profile length differs from the legacy top-view projected length; do not silently substitute one for the other.
  The browser now deliberately uses a new bottom-contour target, not a reinterpretation of the old example.
- Adapt behaves differently by field; it is not a universal promise to preserve all numbers automatically.
- An oblique plan-view ball width is not automatically our side extent at a particular forward position.
- Future girths need named measurement paths around the 3D last, not just a generic width or circumference.
- Room for an internal insert is not external sole thickness.
The sources do not give us exact curve algorithms or establish the meaning of every percentage control.

**Established definitions:** the [ISO 19408:2023 preview](https://cdn.standards.iteh.ai/sist-preview/83107/cb5f303e387a42a6842831f8721fb244/ISO-19408-2023.pdf)
covers last heel height (rear underside to ground in normal orientation, §3.2.6), heel seat (§3.2.7),
and toe spring (toe underside to ground, §3.2.13). These are last definitions, not shoe sole-stack inputs.
The [Bird anatomy reference](https://shoemaking.wiki/The_Anatomy_of_a_Shoe_Last) locates the breast at the front
of the seat and the tread at the forepart contact. Do not transfer inconsistent shoe-height wording into our last definition.

**Our prototype guide:** horizontal ground at z=0 and four profile segments for seat, waist, contact blend, and straight forepart.
This is not a sourced universal curve recipe or a validated 3D bottom. See the
[bottom-profile specification](bottom-profile.md), implemented as a numeric/SVG experiment. Version 2 replaces the
rejected S-shaped rise with the user's chosen rounded transition and exactly straight incline through the toe.
Its explicit 10 mm development blend is not an anatomical default. ISO defines height terminology, not this shape;
the linked MDN Bézier explanation supports the representation, not a universal footwear recipe.
Browser display is separate from geometry. The earlier plain HTML/native JavaScript viewer with Python geometry is now a legacy reference.
The production application uses an actual [create-t3-app](https://create.t3.gg/en/installation) scaffold adapted to Next.js 16 App Router,
React, TypeScript, Tailwind CSS, and tRPC. One independent TypeScript geometry module supplies the canonical models/reports;
Three.js displays reference guides only. There is no Python runtime bridge, authentication, database, or persistence layer.
The current pnpm-only setup and optional Python comparison tools are documented in [README](../README.md).
Numeric/API parity is checked with nine frozen Python fixtures plus independent TypeScript checks; React/browser acceptance
is a separate step. No 3D last surface or improved high-heel posture model is established by this technology change.

**New contour adapter assumption:** `last_length` is measured along our actual bottom guide. Top stations are distances
along that guide, mapped separately to forward positions; seat/waist/blend/ramp arc lengths remain fixed during heel edits.
The [vendor guide](https://3dshoemaker.com/measurements-in-shoe-last-maker/) supports distinguishing contour length
from projection, not our station anchors, region preservation, or solver. Its internal algorithms remain unknown.
The chosen 250 mm contour target intentionally changes the old 250 mm projected shape. A user-entered seat angle
and the existing rounded-transition/straight-ramp rule still apply; this is not a sourced heel-posture formula.
