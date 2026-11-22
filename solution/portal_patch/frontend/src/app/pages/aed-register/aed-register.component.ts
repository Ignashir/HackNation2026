import { DatePipe, NgForOf, NgIf, UpperCasePipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { combineLatest, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { DatasetRestrictionsComponent } from '@app/pages/dataset/dataset-restrictions/dataset-restrictions.component';
import { ApiConfig } from '@app/services/api';
import { DatasetService } from '@app/services/dataset.service';
import { IDatasetFile } from '@app/services/models/dataset-resource';
import { SeoService } from '@app/services/seo.service';
import { StandardAggregate, StandardsService } from '@app/services/standards.service';
import { DownloadLinkComponent } from '@app/shared/download-link/download-link.component';
import { LinkHelper } from '@app/shared/helpers';
import { MapComponent } from '@app/shared/map/map.component';
import { ResourceFiltersComponent } from '@app/shared/resource-filters/resource-filters.component';
import { ResourceTableNoFiltersComponent } from '@app/shared/resource-table-no-filters/resource-table-no-filters.component';
import { AppShellNoRenderDirective } from '@app/ssr/app-shell-no-render.directive';

/**
 * National AED list ("Krajowy wykaz AED"), laid out like the DGA list of protected data
 * (pages/dga-information-point/dga-information-point-table-page): the combined list is a resource on the portal,
 * shown with the portal's own table. Backend: mcod.standards, GET /standards/aed/aggregated.
 */
@Component({
  selector: 'app-aed-register',
  templateUrl: './aed-register.component.html',
  styleUrls: ['./aed-register.component.scss'],
  standalone: true,
  imports: [
    NgIf,
    NgForOf,
    DatePipe,
    UpperCasePipe,
    RouterLink,
    TranslatePipe,
    DownloadLinkComponent,
    ResourceFiltersComponent,
    ResourceTableNoFiltersComponent,
    DatasetRestrictionsComponent,
    MapComponent,
    AppShellNoRenderDirective,
  ],
})
export class AedRegisterComponent implements OnInit {
  aggregate: StandardAggregate;
  resource: any;
  dataset: any;
  resourceId: string;
  pageTitle = 'Krajowy wykaz AED';
  viewsCount: string;
  downloadsCount: string;
  downloadFilesList: IDatasetFile[] = [];
  view: 'table' | 'map' = 'table';
  collapsed = true;
  showAnimation = false;
  error = false;
  apiUrl = `/api${ApiConfig.apiVersion}${ApiConfig.standard_aggregated.replace(':code', 'aed')}`;

  constructor(
    private standardsService: StandardsService,
    private datasetService: DatasetService,
    private seoService: SeoService,
    private translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.seoService.setPageTitle(this.pageTitle);
    this.standardsService
      .getAggregate('aed')
      .pipe(
        switchMap((aggregate) =>
          combineLatest([
            of(aggregate),
            this.datasetService.getResourceById('' + aggregate.resource_id),
            this.datasetService.getDatasetsStats('' + aggregate.dataset_id, aggregate.dataset_slug),
          ]),
        ),
      )
      .subscribe({
        next: ([aggregate, resource, stats]) => {
          this.aggregate = aggregate;
          this.resourceId = '' + aggregate.resource_id;
          this.resource = resource;
          this.downloadFilesList = resource?.attributes?.files ?? [];
          this.dataset = stats?.['data'];
          this.viewsCount = this.dataset?.attributes?.views_count;
          this.downloadsCount = this.dataset?.attributes?.downloads_count;
        },
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

  show(view: 'table' | 'map', event: Event): void {
    event.preventDefault();
    this.view = view;
  }

  toggleCollapsed(): void {
    if (this.collapsed) {
      this.collapsed = false;
      setTimeout(() => (this.showAnimation = true), 1);
    } else {
      this.showAnimation = false;
      setTimeout(() => (this.collapsed = true), 1000);
    }
  }

  downloadResource(title: string, url: string): void {
    LinkHelper.downloadResource({ title, url });
  }
}
