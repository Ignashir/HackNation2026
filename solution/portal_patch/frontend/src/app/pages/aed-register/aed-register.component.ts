import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

import { ApiConfig } from '@app/services/api';
import { StandardAggregate, StandardsService } from '@app/services/standards.service';
import { MapComponent } from '@app/shared/map/map.component';
import { ResourceTableNoFiltersComponent } from '@app/shared/resource-table-no-filters/resource-table-no-filters.component';
import { AppShellNoRenderDirective } from '@app/ssr/app-shell-no-render.directive';

/**
 * National AED list ("Krajowy wykaz AED"): the combined list of all AED registers that conform to the AED data
 * standard, published by the coordinating institution (backend: mcod.standards, GET /standards/aed/aggregated).
 */
@Component({
  selector: 'app-aed-register',
  templateUrl: './aed-register.component.html',
  styleUrls: ['./aed-register.component.scss'],
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, RouterLink, ResourceTableNoFiltersComponent, MapComponent, AppShellNoRenderDirective],
})
export class AedRegisterComponent implements OnInit {
  aggregate: StandardAggregate;
  error = false;
  view: 'map' | 'table' = 'map';
  apiUrl = `/api${ApiConfig.apiVersion}${ApiConfig.standard_aggregated.replace(':code', 'aed')}`;

  constructor(
    private standardsService: StandardsService,
    private translate: TranslateService,
  ) {}

  ngOnInit() {
    this.standardsService.getAggregate('aed').subscribe({
      next: (data) => (this.aggregate = data),
      error: () => (this.error = true),
    });
  }

  get lang(): string {
    return this.translate.currentLang || 'pl';
  }

  fmt(value: number): string {
    return (value ?? 0).toLocaleString('pl-PL');
  }

  datasetUrl(datasetId: number): string {
    return `/${this.lang}/dataset/${datasetId}`;
  }

  resourceUrl(datasetId: number, resourceId: number): string {
    return `/${this.lang}/dataset/${datasetId}/resource/${resourceId}`;
  }
}
