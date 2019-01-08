"use strict";

import { injectable, inject } from "inversify";
import { ConfigurationService } from "../../config/configuration";
import { LOGGER } from "../../logger";

import * as request from "request";
import { SonarIssueResponse, SonarIssueQuery, SonarIssue, SonarPaging } from "../model/sonar-issue";

@injectable()
export class SonarClient {
	private configurationService: ConfigurationService;

	constructor(
		@inject(ConfigurationService) configurationService: ConfigurationService,
	) {
		this.configurationService = configurationService;

		if (!this.configurationService.get().sonar.base) {
			LOGGER.warn("Sonar base URL seems to be not configured. This will lead to errors.");
		}
	}

	private async getIssue(queryParams: SonarIssueQuery, page = 1): Promise<SonarIssueResponse> {
		LOGGER.debug("retrieve page %s for project %s", page, queryParams.componentKeys);

		queryParams.p = page;

		const options: request.CoreOptions = {
			qs: queryParams,
		};

		// add auth to options, if sonar token is available
		if (this.configurationService.get().sonar.token) {
			options.auth = {
				username: this.configurationService.get().sonar.token
			};
		}

		return new Promise<SonarIssueResponse>((resolve, reject) => {
			request(
				this.configurationService.get().sonar.base + "/api/issues/search",
				options,
				(error: any, response: request.Response, body: any) => {
					try {
						if (!error && response.statusCode == 200) {
							resolve(JSON.parse(body) as SonarIssueResponse);
						} else {
							if (error) {
								reject(error);
							}
						}
					} catch (err) {
						reject(err);
					}
				}
			);
		});
	}

	public pagingNecessary(paging: SonarPaging): boolean {
		return paging.pageSize * paging.pageIndex < paging.total;
	}

	public getIssues(projectKey: string, branch: string): Promise<SonarIssue[]> {
		return new Promise<SonarIssue[]>(async (resolve, reject) => {
			let issues: SonarIssue[] = [];

			const query: SonarIssueQuery = {
				componentKeys: projectKey,
				branch: branch,
				statuses: "OPEN,CONFIRMED,REOPENED",
				resolved: false
			};

			let page = 0;
			let issuePage;
			try {
				do {
					issuePage = await this.getIssue(query, page + 1);
					issues = issues.concat(issuePage.issues);
					page = issuePage.paging.pageIndex;
				} while (this.pagingNecessary(issuePage.paging));
			} catch (err) {
				LOGGER.error("an error occured while paginating through issues of project %s. Skipping issue collection\nCaused by: %s", projectKey, err);
				reject(err);
			}

			resolve(issues);
		});
	}
}