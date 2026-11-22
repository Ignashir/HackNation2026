# dane.gov.pl frontend changes (Angular): national AED list page + standard badge

New files: copy `src/` over `codebase/frontend_latest/src/`.

| File | What |
|---|---|
| `src/app/pages/aed-register/*` | Page `/pl/aed` "Krajowy wykaz AED": stats, providers, download/changes/API links, map + table of the national list (reuses `shared/map` and `shared/resource-table-no-filters`) |
| `src/app/services/standards.service.ts` | `GET /standards/:code/aggregated` (backend `mcod.standards.views.StandardAggregateView`) |

Edits to existing files (small, apply by hand):

1. `src/app/services/api/api.config.ts`: after `dga_aggregated`, add
   `standard_aggregated = '/standards/:code/aggregated',`
2. `src/app/services/models/routerEndpoints.ts`: after `DGA = 'dga',`, add `AED = 'aed',`
3. `src/app/app-routing.module.ts`: before the `'!brokenlinks'` route, add
   ```ts
   {
     path: '!aed',
     data: { breadcrumbs: { translationKey: 'AedRegister.Self' } },
     loadChildren: () => import('./pages/aed-register/aed-register.routes').then((mod) => mod.AED_REGISTER_ROUTES),
   },
   ```
4. `src/app/layout/header/header.component.html`: a menu item before the DGA one, the same markup with
   `routerEndpoints.AED`, `#menuLinkAedRegister` and `{{ 'Menu.AedRegister' | translate }}`.
5. `src/assets/i18n/pl.json` / `en.json`: `Menu.AedRegister` = "Wykaz AED" / "AED list", and
   `AedRegister.Self` = "Krajowy wykaz AED" / "National AED list".
6. `src/app/pages/dataset/dataset-item/dataset-item.component.html`: under the `<h1>`, a badge shown when
   `dataset.attributes.data_standard` is set ("✓ Standard danych: …", with a link to `/aed` for code `aed`).
7. `angular.json` (local dev only): serve configuration `local` gets `"prebundle": { "exclude": ["leaflet"] }`.
