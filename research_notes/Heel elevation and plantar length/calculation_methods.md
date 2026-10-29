# Heel elevation and plantar length: calculation methods

## What published methods calculate, and what inputs do they require?

### Takeaway

The strongest reusable methods are subject-specific kinematic/geometry methods that calculate a *defined internal plantar-fascia path* from bone motion, or a full foot finite-element model that estimates internal tissue strain under specified loads. Neither predicts external plantar-skin material path length from heel height alone. The closest direct evidence for plantar skin reports skin deformation under ankle-posture changes, but does not provide a validated heel-height-to-plantar-surface-length conversion.

### Cited Findings

1. **Best methodological analogue for a measured internal path — Sun et al. (2022), in-vivo dual fluoroscopy (DFIS), not skin.** The paper says it modeled plantar fascia (PF) length as “the average length of the long line segments ... and the short line segments” connecting calcaneus origin to sesamoid contact points and then to phalanx insertions; reported PF strain as `(instantaneous PF length − neutral-position length) / neutral-position length × 100%` (Methods §§2.3.1, 2.4). The needed inputs were subject CT-derived 3D bone models, bone coordinate systems, dynamic biplanar X-ray registration, foot posture reference, and explicitly chosen PF origin/contact/insertion points. The 15-person study measured bone kinematics and inferred a simplified PF path during running; it did not measure plantar-skin path length or heel elevation. It acknowledges that its two-line-segment PF model crosses the sesamoid, although the anatomical PF wraps around it. [Full article, DOI 10.3389/fbioe.2022.959807](https://doi.org/10.3389/fbioe.2022.959807)

2. **Best heel-elevation computational analogue — Wang et al. (2021), musculoskeletal model + FEM, internal fascia strain only.** The authors tested 3, 5, and 7 cm heels for one healthy 26-year-old woman. They used subject MRI-based geometry (28 bones, soft tissue, cartilage, fascia), shoe geometry, measured gait/ground-reaction forces, OpenSim muscle-force estimates, and FEM boundary conditions at three stance instants. They report plantar-fascia strain increasing across heel conditions in this particular model; e.g. at second-peak stance, proximal-region peak strain rose 102% from 3 to 7 cm. Their validation compared plantar pressure prediction with an in-shoe pressure system (reported correlation `r = 0.83`) and checked fascia values against prior literature—not against skin deformation or measured plantar path length. The authors explicitly limit generalization: only one subject, linear fascia/ligament/cartilage material assumptions, omitted intrinsic muscles, and simplified model DOFs. Thus it shows the *kind* of inputs a predictive internal-tissue model needs, not a reusable skin-stretch coefficient. [Full article, DOI 10.3389/fbioe.2021.791238](https://doi.org/10.3389/fbioe.2021.791238)

3. **Direct plantar-skin deformation evidence — Smith et al. (2019), foot posture experiment.** The publisher abstract reports: “In the dorsiflexion ankle posture, the skin of the foot sole was observed to stretch on average by 5 ± 1%”; it also reports skin hardness/thickness changes. This is directly about plantar *skin*, unlike fascia studies, but its reported posture is ankle dorsiflexion, not a specified heel lift plus measured MTP angle. It supplies no general individual-specific heel-height-to-skin-length relationship in the abstract, and the available report does not establish a transferable heel-to-toe tape-path prediction. Treat the 5% as a task-specific experimental result, not a correction factor. [Journal of the Mechanical Behavior of Biomedical Materials 95 (2019), 240–248, DOI 10.1016/j.jmbbm.2019.04.012](https://doi.org/10.1016/j.jmbbm.2019.04.012); [PubMed record](https://pubmed.ncbi.nlm.nih.gov/31054375/)

4. **Cadaveric heel-elevation experiments — Kogler et al. (2001), internal plantar-aponeurosis strain.** The original abstract describes quantifying plantar-aponeurosis strain in cadaveric feet under different heel-elevation configurations. Wang et al.’s later paper distinguishes this setup from stiletto shoes: Kogler used a contoured platform with an extended shank/arch-support profile under the foot, whereas Wang modeled narrow heel support. This is important evidence that “heel elevation” is not a single mechanical condition, but the measured endpoint is fascia strain, not skin surface length. [Original article, Foot & Ankle International 22(5), 433–439, DOI 10.1177/107110070102200513](https://doi.org/10.1177/107110070102200513); [PubMed abstract](https://pubmed.ncbi.nlm.nih.gov/11428764/); [Wang et al. discussion](https://doi.org/10.3389/fbioe.2021.791238)

5. **Windlass and MTPJ models concern internal fascia, not plantar skin.** Cheng et al. evaluated plantar-fascia behavior due to the windlass mechanism using nonlinear FEM, with MTPJ dorsiflexion angle as a model input; a related paper varied windlass and Achilles-tendon loading. Such a model needs foot geometry, fascia material properties, joint configuration, and boundary/load conditions. It can estimate fascia length/tension/strain in its defined anatomical model; it does not establish that heel height uniquely sets MTP angle, nor that fascial length change equals skin material stretch. [Cheng et al. (2008), DOI 10.3113/FAI.2008.0845](https://doi.org/10.3113/FAI.2008.0845); [Cheng et al. (2008), DOI 10.1016/j.jbiomech.2008.03.028](https://doi.org/10.1016/j.jbiomech.2008.03.028)

### Inferences

- The closest method genuinely reusable in a future tool is **subject-specific paired surface measurement** (same foot, standardized conditions, same marked plantar track) or a subject-specific geometry/kinematics model whose output is explicitly labeled as a *geometric skin-surface path*. The literature reviewed here does not supply a validated population-level reduced equation for converting heel height to plantar skin path-length change.
- A DFIS/MRI/CT-to-FEM research workflow is technically defensible for internal tissue mechanics, but is excessive and endpoint-mismatched for a parametric last tool unless it is explicitly meant to predict tissue strain and has a specific user’s geometry, posture, contact/support, and loading inputs.
- The user's >1 cm tape observation is useful as a hypothesis for direct repeated measurement, but because the starting/end landmarks, tape tension, path, loading, and postures are unverified, it is not a model parameter or validation target yet.

### Gaps

- No located primary study validated a reduced mapping from shoe heel elevation to *external plantar-skin* heel-to-toe path length across subjects.
- The skin-posture paper’s abstract gives a mean stretch result, but does not establish the precise local measurement path or validity under shoe heel elevation; its full method/results must be consulted before using even its posture-specific percentage quantitatively.
- No reviewed study supplies a broadly reusable statistical predictor with inputs such as foot geometry, individual MTP angle/radii, plantar skin landmarks, loading, and reference posture, plus independent validation against actual plantar skin path measurements.

## How do geometry, MTP dorsiflexion, fascia, and skin relate—and what is transferable?

### Takeaway

The windlass mechanism is a useful anatomical explanation of how MTP dorsiflexion can wind the plantar fascia around metatarsal-head/sesamoid geometry and alter arch configuration. It is not a universal conversion from heel rise to MTP angle, nor from a fascia’s geometric path or strain to the material stretch of the external skin. The input must be actual joint posture and individual anatomy; heel height alone does not specify either.

### Cited Findings

- Sun et al. describe two distinct contributors to PF length change: medial longitudinal arch (MLA) compression and first-MTP extension/dorsiflexion. Their DFIS method measured the calcaneus, first metatarsal, first proximal phalanx and sesamoid kinematics rather than inferring MTP angle from heel height. This supports treating arch posture and MTP motion as separate measured kinematic inputs. It also notes soft-tissue artifacts in skin-marker capture and uses radiographic bone tracking to avoid those artifacts. [Sun et al. (2022), §§1–2](https://doi.org/10.3389/fbioe.2022.959807)
- Sun et al.’s PF length is a **modeled internal tissue route**, formed from line segments passing via sesamoid contact points. The authors note the two-line approximation’s geometric limitation. Their result is not a plantar skin surface geodesic and not a direct measurement of skin material strain. [Sun et al. (2022), Methods §2.3.1 and Limitations](https://doi.org/10.3389/fbioe.2022.959807)
- Wang et al. discuss that MTP dorsiflexion can increase under high-heel conditions and intensify fascia loading through the windlass, but their FEM study itself models fascia strain, not the external plantar skin or an independently verified heel-height→MTP-angle law. Its reported 3/5/7 cm conditions are one participant’s shoe/gait model. [Wang et al. (2021), Discussion and Limitations](https://doi.org/10.3389/fbioe.2021.791238)
- The direct plantar-skin study found that skin deformation depends on foot posture and measured changes in foot-sole skin in an ankle-dorsiflexion posture. That is evidence skin is deformable and posture-dependent; it does not identify the plantar fascia as a proxy for skin or validate heel lift as equivalent to ankle dorsiflexion. [Smith et al. (2019), DOI 10.1016/j.jmbbm.2019.04.012](https://doi.org/10.1016/j.jmbbm.2019.04.012)

### Inferences

- The elementary `radius × angle` arc-length relation has a narrow geometric interpretation: it gives arc travel for a point/path wrapped around an assumed circular surface when angle is in radians. In windlass use, the relevant radius would need to describe the actual path around the metatarsal head/sesamoids, and the angle must be actual toe/joint rotation. It is not a general plantar skin-growth equation, and it cannot be evaluated from heel height without additional kinematic and anatomical data.
- Even if skin bridges or follows a changing anatomical contour, the material length of a skin strip can differ from its observed surface geodesic because of local sliding, compression, shear, and skin strain. A geometric surface path between landmarks and material strain of the skin are distinct observables; a tool should say which one it predicts/measures.
- To estimate internal fascia response, actual first-MTP angle, arch/segment geometry, loading, support shape, and subject-specific material assumptions matter. To estimate external skin path change, directly observing skin landmarks/surface in both conditions is the relevant validation target. The two outputs should not be substituted for one another.

### Gaps

- I found no validated functional relation that maps a specified heel elevation to a unique first-MTP dorsiflexion angle across feet; posture, shoe support/contour, gait or static loading, and individual foot geometry vary.
- I found no established fixed metatarsal-head radius that converts MTP angle into external plantar skin path change for diverse subjects. The actual path/axis and tissue deformation would require subject- and condition-specific measurement.

## Ranked options for the present planning tool; seductive shortcuts to reject

### Takeaway

**No published reduced predictor found is ready to implement for plantar skin path change from heel lift alone.** For now, keep heel elevation, actual toe/MTP angle, fascia mechanics, and plantar-surface length as separate quantities. If a numeric plantar-surface delta is needed, the defensible near-term option is to make it an explicitly measured, user-specific input or measure it from two subject-specific surface scans under documented conditions—not invent a skin correction from fascia mechanics.

### Cited Findings

1. **Rank 1 — Direct repeated plantar-surface measurement (best endpoint match; not a literature-derived universal predictor).** The Smith et al. result establishes posture-dependent plantar-skin deformation, but not a reusable heel-lift equation. Measure the actual same foot in the selected flat/raised conditions, with recorded heel height, support/sole contour, load/posture, toe angle, landmark endpoints, path definition, and tape/scan protocol. Repeated paired measures can inform that person’s planning value; this is measurement, not a claim of general predictive validity. [Smith et al. (2019)](https://doi.org/10.1016/j.jmbbm.2019.04.012)
2. **Rank 2 — Subject-specific paired 3D surface scans, if “length” means geometric surface path.** Register both plantar surfaces to common anatomical landmarks and report the path metric and posture/reference explicitly. The studies located do not validate this as material skin strain; scan-derived geodesic change is the visible geometric path, while material tracking requires identifiable skin landmarks/material correspondence. (This is a measurement recommendation, not an existing validated heel-height predictor.)
3. **Rank 3 — DFIS/CT bone kinematics and fascia path reconstruction, only if the target is internal PF path/strain.** Sun et al. demonstrate a published method with clear inputs and neutral reference. It is not a consumer-tool shortcut: it requires radiation-based bone-motion capture and an anatomical path model, and it predicts fascia rather than skin. [Sun et al. (2022)](https://doi.org/10.3389/fbioe.2022.959807)
4. **Rank 4 — Musculoskeletal/FEM model for internal load/strain under specified footwear and task.** Wang et al. demonstrate integration of scanned anatomy, shoe geometry, walking kinematics/forces, muscle forces, and boundary conditions, but the study is single-subject, load/task-specific, and not externally validated for plantar-skin length. Do not treat it as a last-planning length formula. [Wang et al. (2021)](https://doi.org/10.3389/fbioe.2021.791238)

**Reject these shortcuts:**

- **“Heel height → toe angle.”** No unique mapping was found; studies either measure kinematics or model fascia strain under a defined setup. Do not substitute heel height for actual first-MTP dorsiflexion.
- **Using `r × θ` as a universal heel-to-toe length correction.** It only describes a specified path wrapping around an assumed radius; it needs actual angular rotation and anatomical radius/path. It is not a validated skin-stretch law.
- **Using plantar-fascia strain/length as plantar-skin strain/length.** Fascia is internal connective tissue, has different attachments and path, and is subject to load; the cited fascia models do not measure skin material length.
- **Treating the windlass mechanism as skin stretch.** Windlass describes fascia winding and related arch behavior as the toes dorsiflex; it is not an external skin model.
- **Taking 5 ± 1% from the Smith ankle-dorsiflexion skin experiment as a universal heel-lift correction.** It is a posture-specific mean from a different experimental condition, not a heel-height dose-response or an individual’s taped path delta.
- **Fitting the user’s >1 cm observation into a formula.** The datum’s measurement conditions and direction are not independently verified, and one observation cannot establish a general law.

### Inferences

- The planning tool can safely expose independently controlled parameters for rearfoot elevation and toe/MTP posture, while leaving any plantar-surface path-length change as unpredicted/unknown unless directly measured. If a subject-specific measurement is later obtained, preserve its test conditions and label it as such rather than generalizing it to other feet.
- A validated reduced relation would need paired direct plantar skin/path-length measurements across varying heel elevations and actual MTP angles, individual geometry/radii and foot posture, loading/support conditions, and a separate held-out-subject validation set. No located source supplies that dataset/model.

### Gaps

- No source located gives a population-validated heel-height-to-external-plantar-skin-path model suitable for direct implementation.
- The literature reviewed does not establish whether the user’s particular flat-to-raised tape difference reflects a skin-material stretch, a changed geometric contour/path, altered foot posture, tape handling, or some combination. That needs controlled repeat measurement, not theoretical correction.
