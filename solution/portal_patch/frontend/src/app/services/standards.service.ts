import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { CookieService } from 'ngx-cookie-service';
import { LocalStorageService } from 'ngx-localstorage';

import { ApiConfig } from '@app/services/api';
import { LoginService } from '@app/services/login-service';
import { NotificationsService } from '@app/services/notifications.service';
import { RestService } from '@app/services/rest.service';
import { TemplateHelper } from '@app/shared/helpers/template.helper';

export interface StandardAggregateProvider {
  provider: string;
  provider_id: number;
  dataset_id: number;
  resource_id: number;
  rows: number;
  precedence: number;
}

export interface StandardAggregate {
  standard: string;
  version: string;
  title: string;
  owner: string;
  dataset_id: number;
  dataset_slug: string;
  resource_id: number;
  resource_slug: string;
  changes_resource_id: number | null;
  full_resource_id: number | null;
  conflicts_resource_id: number | null;
  rows: number;
  source_rows: number;
  merged_devices: number;
  possible_duplicates: number;
  conflicts: number;
  added: number;
  changed: number;
  removed: number;
  providers: StandardAggregateProvider[];
  built_at: string;
}

@Injectable({
  providedIn: 'root',
})
export class StandardsService extends RestService {
  readonly ApiConfig = ApiConfig;

  constructor(
    protected http: HttpClient,
    public translate: TranslateService,
    public router: Router,
    public notificationService: NotificationsService,
    public storageService: LocalStorageService,
    public cookieService: CookieService,
    public loginService: LoginService,
    @Inject(DOCUMENT) public document: any,
    @Inject(PLATFORM_ID) public platformId: string,
  ) {
    super(
      http,
      translate,
      router,
      notificationService,
      storageService,
      cookieService,
      loginService,
      document,
      platformId,
    );
  }

  /**
   * National (combined) list of a data standard, e.g. the national AED list (code "aed").
   */
  getAggregate(code: string): Observable<StandardAggregate> {
    return this.get(TemplateHelper.parseUrl(this.ApiConfig.standard_aggregated, { code }));
  }
}
