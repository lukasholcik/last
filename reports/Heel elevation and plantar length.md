# Heel elevation and plantar length

## Finding

The verified sources reviewed do not provide a validated coefficient or reduced calculation for predicting the tape-following underside heel-to-toe plantar-surface path from heel elevation alone. The reported personal difference of over 1 cm is an observation for that foot and setup; its heel height, load, path, landmarks, tape tension, and direction were not specified in this discussion. The literature below neither validates nor refutes that individual observation. Published work measures skin deformation, projected foot dimensions, or internal plantar-fascia mechanics—different outcomes from the requested surface path.

## Closest primary sources

### Direct plantar skin measurements

Smith et al. (2019) studied 10 healthy young adults in passively maintained static plantar-flexed, neutral, and dorsiflexed postures. An 11×4 marker grid measured skin stretch on sole and dorsum. The indexed original abstract reports average plantar-skin stretch of **5 ± 1% in dorsiflexion** and relaxation/retraction of **9 ± 2% in plantar flexion**. This is direct skin-deformation evidence, but not a standing heel-height test or heel-to-toe tape-path measurement. Do not use either percentage as a heel-lift correction.

Sources: [DOI 10.1016/j.jmbbm.2019.04.012](https://doi.org/10.1016/j.jmbbm.2019.04.012) · [PubMed original abstract](https://pubmed.ncbi.nlm.nih.gov/31054375/). Access limitation: the indexed abstract was verified; the full publisher article was not accessible during verification.

### Whole-foot shape under heel elevation

Kouchi & Tsutsumi (2000), *3D Foot Shape and Shoe Heel Height*, measured 39 adult women standing on simulated 0, 4, and 8 cm heel platforms, including alginate impressions of the plantar underside. The paper documents region-dependent changes and individual differences. Its reported medial arch length is measured **parallel to the X-axis**, not along the skin surface (p. 336). Making a plantar impression does not turn those reported lengths into heel-to-toe skin paths. This is a close reference for posture-dependent whole-foot geometry, not the requested scalar correction.

Sources: [DOI 10.1537/ase.108.331](https://doi.org/10.1537/ase.108.331) · [J-STAGE article](https://www.jstage.jst.go.jp/article/ase1993/108/4/108_4_331/_article/-char/en) · [Original PDF](https://www.jstage.jst.go.jp/article/ase1993/108/4/108_4_331/_pdf).

### Other heel-elevation anthropometry

Wan, Yick & Yu (2017) studied 45 women at 0, 5, and 10 cm heel conditions. Their accepted manuscript explicitly states that **the plantar surface was not scanned** (p. 20). Its forefoot findings cannot supply the underside path.

Sources: [DOI 10.1016/j.measurement.2016.12.005](https://doi.org/10.1016/j.measurement.2016.12.005) · [Institutional manuscript](https://ira.lib.polyu.edu.hk/handle/10397/65812).

Zhu & Lee (2023) scanned 35 women in wedge conditions combining 10/20/30 mm forefoot heights with 30/50/70/90 mm heel heights and a 15° toe spring. It reports conventional foot-dimension changes, not the requested underside path, and has no flat 0 mm heel baseline.

Sources: [DOI 10.1186/s40691-023-00347-7](https://doi.org/10.1186/s40691-023-00347-7) · [Open original PDF](https://d-nb.info/1304595374/34).

## Existing calculations and CAD practice

Sun et al. (2022) use CT and dual-fluoroscopy data to reconstruct an **internal plantar-fascia** path. Wang et al. (2021) model internal fascia strain under 3/5/7 cm heels in one woman during walking. Neither predicts external skin-path change. A relative increase in peak fascia strain is not a percentage increase in foot length.

Sources: [Sun, DOI 10.3389/fbioe.2022.959807](https://doi.org/10.3389/fbioe.2022.959807) · [Wang, DOI 10.3389/fbioe.2021.791238](https://doi.org/10.3389/fbioe.2021.791238) · [Wang full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC8720874/).

Windlass mechanics concern fascia winding and arch behaviour. They do not establish a unique heel-height-to-toe-angle relation or equate fascia strain with skin strain. A radius-times-angle calculation requires a defined path, radius, and actual rotation; it is not a validated universal skin correction.

LutraCAD's official documentation distinguishes **Rotate**, which leaves the foot unmodified, from **Correct**, which adjusts the model to a desired heel lift. Its scan/template workflows also offer choices about following plantar scan geometry. These document existing geometry adaptation, but disclose no physiological plantar-skin compensation coefficient or validated contour-length rule.

Sources: [LutraCAD shoe-last guide](https://academy.lutracad.com/cad/how-to/shoe-lasts/) · [Base controls](https://academy.lutracad.com/cad/design/shoe-lasts/base/).

## Implications for the modeller

- Preserve the flat-foot reference separately from any posture-specific measurements or adaptation.
- Do not use projected-length changes, fascia strain, or the skin study's percentages as interchangeable corrections.
- If a numeric surface-path adjustment is needed, paired posture-specific measurements match the requested endpoint more closely than the located indirect models. A geometric path difference is not itself a measurement of skin-material strain.
- Treat the current fixed bottom-contour rule as a construction convention, not sourced physiology. These findings leave anatomical adaptation open; they do not justify assigning the entire measured difference to the toe or uniformly across the last.
- No implementation or foot-first schema change was approved by this research. The bounded search found no verified ready-to-use heel-height-to-plantar-path predictor; that is not proof that none exists.
