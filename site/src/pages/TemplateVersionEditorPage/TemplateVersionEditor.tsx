import { type Interpolation, type Theme, useTheme } from "@emotion/react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { getErrorDetail, getErrorMessage } from "api/errors";
import type {
	ProvisionerJobLog,
	Template,
	TemplateVersion,
	TemplateVersionVariable,
	VariableValue,
	WorkspaceResource,
} from "api/typesGenerated";
import { Alert } from "components/Alert/Alert";
import { Button } from "components/Button/Button";
import { Sidebar } from "components/FullPageLayout/Sidebar";
import {
	Topbar,
	TopbarAvatar,
	TopbarButton,
	TopbarData,
	TopbarDivider,
	TopbarIconButton,
} from "components/FullPageLayout/Topbar";
import { displayError } from "components/GlobalSnackbar/utils";
import { Loader } from "components/Loader/Loader";
import { TriangleAlertIcon } from "lucide-react";
import { ChevronLeftIcon } from "lucide-react";
import { ExternalLinkIcon, PlayIcon, PlusIcon, XIcon } from "lucide-react";
import { linkToTemplate, useLinks } from "modules/navigation";
import { ProvisionerAlert } from "modules/provisioners/ProvisionerAlert";
import { AlertVariant } from "modules/provisioners/ProvisionerAlert";
import { ProvisionerStatusAlert } from "modules/provisioners/ProvisionerStatusAlert";
import { TemplateFileTree } from "modules/templates/TemplateFiles/TemplateFileTree";
import { isBinaryData } from "modules/templates/TemplateFiles/isBinaryData";
import { TemplateResourcesTable } from "modules/templates/TemplateResourcesTable/TemplateResourcesTable";
import { WorkspaceBuildLogs } from "modules/workspaces/WorkspaceBuildLogs/WorkspaceBuildLogs";
import type { PublishVersionData } from "pages/TemplateVersionEditorPage/types";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import {
	Link as RouterLink,
	unstable_usePrompt as usePrompt,
} from "react-router-dom";
import { MONOSPACE_FONT_FAMILY } from "theme/constants";
import {
	type FileTree,
	createFile,
	existsFile,
	getFileText,
	isFolder,
	moveFile,
	removeFile,
	updateFile,
} from "utils/filetree";
import {
	CreateFileDialog,
	DeleteFileDialog,
	RenameFileDialog,
} from "./FileDialog";
import { MissingTemplateVariablesDialog } from "./MissingTemplateVariablesDialog";
import { MonacoEditor } from "./MonacoEditor";
import { ProvisionerTagsPopover } from "./ProvisionerTagsPopover";
import { PublishTemplateVersionDialog } from "./PublishTemplateVersionDialog";
import { TemplateVersionStatusBadge } from "./TemplateVersionStatusBadge";

type Tab = "logs" | "resources" | undefined; // Undefined is to hide the tab

interface TemplateVersionEditorProps {
	template: Template;
	templateVersion: TemplateVersion;
	defaultFileTree: FileTree;
	buildLogs?: ProvisionerJobLog[];
	resources?: WorkspaceResource[];
	isBuilding: boolean;
	canPublish: boolean;
	onPreview: (files: FileTree) => Promise<void>;
	onPublish: () => void;
	onConfirmPublish: (data: PublishVersionData) => void;
	onCancelPublish: () => void;
	publishingError?: unknown;
	publishedVersion?: TemplateVersion;
	onCreateWorkspace: () => void;
	isAskingPublishParameters: boolean;
	isPromptingMissingVariables: boolean;
	isPublishing: boolean;
	missingVariables?: TemplateVersionVariable[];
	onSubmitMissingVariableValues: (values: VariableValue[]) => void;
	onCancelSubmitMissingVariableValues: () => void;
	defaultTab?: Tab;
	provisionerTags: Record<string, string>;
	onUpdateProvisionerTags: (tags: Record<string, string>) => void;
	activePath: string | undefined;
	onActivePathChange: (path: string | undefined) => void;
}

export const TemplateVersionEditor: FC<TemplateVersionEditorProps> = ({
	isBuilding,
	canPublish,
	template,
	templateVersion,
	defaultFileTree,
	onPreview,
	onPublish,
	onConfirmPublish,
	onCancelPublish,
	isAskingPublishParameters,
	isPublishing,
	publishingError,
	publishedVersion,
	onCreateWorkspace,
	buildLogs,
	resources,
	isPromptingMissingVariables,
	missingVariables,
	onSubmitMissingVariableValues,
	onCancelSubmitMissingVariableValues,
	defaultTab,
	provisionerTags,
	onUpdateProvisionerTags,
	activePath,
	onActivePathChange,
}) => {
	const getLink = useLinks();
	const theme = useTheme();
	const [selectedTab, setSelectedTab] = useState<Tab>(defaultTab);
	const [fileTree, setFileTree] = useState(defaultFileTree);
	const [createFileOpen, setCreateFileOpen] = useState(false);
	const [deleteFileOpen, setDeleteFileOpen] = useState<string>();
	const [renameFileOpen, setRenameFileOpen] = useState<string>();
	const [dirty, setDirty] = useState(false);
	const matchingProvisioners = templateVersion.matched_provisioners?.count;
	const availableProvisioners = templateVersion.matched_provisioners?.available;

	const triggerPreview = useCallback(async () => {
		try {
			await onPreview(fileTree);
			setSelectedTab("logs");
		} catch (error) {
			displayError(
				getErrorMessage(error, "Error on previewing the template"),
				getErrorDetail(error),
			);
		}
	}, [fileTree, onPreview]);

	// Stop ctrl+s from saving files and make ctrl+enter trigger a preview.
	useEffect(() => {
		const keyListener = async (event: KeyboardEvent) => {
			if (!(navigator.platform.match("Mac") ? event.metaKey : event.ctrlKey)) {
				return;
			}
			switch (event.key) {
				case "s":
					// Prevent opening the save dialog!
					event.preventDefault();
					break;
				case "Enter":
					event.preventDefault();
					await triggerPreview();
					break;
			}
		};
		document.addEventListener("keydown", keyListener);
		return () => {
			document.removeEventListener("keydown", keyListener);
		};
	}, [triggerPreview]);

	// Automatically switch to the template preview tab when the build succeeds.
	const previousVersion = useRef<TemplateVersion>();
	useEffect(() => {
		if (!previousVersion.current) {
			previousVersion.current = templateVersion;
			return;
		}

		if (
			["running", "pending"].includes(previousVersion.current.job.status) &&
			templateVersion.job.status === "succeeded"
		) {
			setDirty(false);
		}
		previousVersion.current = templateVersion;
	}, [templateVersion]);

	const editorValue = activePath ? getFileText(activePath, fileTree) : "";
	const isEditorValueBinary =
		typeof editorValue === "string" ? isBinaryData(editorValue) : false;

	// Auto scroll
	const logsContentRef = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: consider refactoring
	useEffect(() => {
		if (logsContentRef.current) {
			logsContentRef.current.scrollTop = logsContentRef.current.scrollHeight;
		}
	}, [buildLogs]);

	useLeaveSiteWarning(dirty);

	const canBuild = !isBuilding;
	const templateLink = getLink(
		linkToTemplate(template.organization_name, template.name),
	);

	const gotBuildLogs = buildLogs && buildLogs.length > 0;

	return (
		<>
			<div css={{ height: "100%", display: "flex", flexDirection: "column" }}>
				<Topbar
					css={{
						display: "grid",
						gridTemplateColumns: "1fr 2fr 1fr",
					}}
					data-testid="topbar"
				>
					<div>
						<Tooltip title="Back to the template">
							<TopbarIconButton component={RouterLink} to={templateLink}>
								<ChevronLeftIcon className="size-icon-sm" />
							</TopbarIconButton>
						</Tooltip>
					</div>

					<TopbarData>
						<TopbarAvatar
							src={template.icon}
							fallback={template.display_name || template.name}
						/>
						<RouterLink
							to={templateLink}
							css={{
								color: theme.palette.text.primary,
								textDecoration: "none",

								"&:hover": {
									textDecoration: "underline",
								},
							}}
						>
							{template.display_name || template.name}
						</RouterLink>
						<TopbarDivider />
						<span css={{ color: theme.palette.text.secondary }}>
							{templateVersion.name}
						</span>
					</TopbarData>

					<div
						css={{
							display: "flex",
							alignItems: "center",
							justifyContent: "flex-end",
							gap: 8,
							paddingRight: 16,
						}}
					>
						<span className="mr-2">
							<Button asChild size="sm" variant="outline">
								<a
									href="https://registry.coder.com"
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center"
								>
									Browse the Coder Registry
									<ExternalLinkIcon className="size-icon-sm ml-1" />
								</a>
							</Button>
						</span>

						<TemplateVersionStatusBadge version={templateVersion} />

						<div className="flex gap-1 items-center">
							<TopbarButton
								title="Build template (Ctrl + Enter)"
								disabled={!canBuild}
								onClick={async () => {
									await triggerPreview();
								}}
							>
								<PlayIcon />
								Build
							</TopbarButton>
							<ProvisionerTagsPopover
								tags={provisionerTags}
								onTagsChange={onUpdateProvisionerTags}
							/>
						</div>

						<TopbarButton
							variant="default"
							disabled={dirty || !canPublish}
							onClick={onPublish}
						>
							Publish
						</TopbarButton>
					</div>
				</Topbar>

				<div
					css={{
						display: "flex",
						flex: 1,
						flexBasis: 0,
						overflow: "hidden",
						position: "relative",
					}}
				>
					{publishedVersion && (
						<div
							// We need this to reset the dismissable state of the component
							// when the published version changes
							key={publishedVersion.id}
							css={{
								position: "absolute",
								width: "100%",
								display: "flex",
								justifyContent: "center",
								padding: 12,
								zIndex: 10,
							}}
						>
							<Alert
								severity="success"
								dismissible
								actions={
									<Button
										variant="subtle"
										size="sm"
										onClick={onCreateWorkspace}
									>
										Create a workspace
									</Button>
								}
							>
								Successfully published {publishedVersion.name}!
							</Alert>
						</div>
					)}

					<Sidebar>
						<div
							css={{
								height: 42,
								padding: "0 8px 0 16px",
								display: "flex",
								alignItems: "center",
							}}
						>
							<span
								css={{
									color: theme.palette.text.primary,
									fontSize: 13,
								}}
							>
								Files
							</span>

							<div
								css={{
									marginLeft: "auto",
									"& svg": {
										fill: theme.palette.text.primary,
									},
								}}
							>
								<Tooltip title="Create File" placement="top">
									<IconButton
										aria-label="Create File"
										onClick={(event) => {
											setCreateFileOpen(true);
											event.currentTarget.blur();
										}}
									>
										<PlusIcon className="size-icon-xs" />
									</IconButton>
								</Tooltip>
							</div>
							<CreateFileDialog
								fileTree={fileTree}
								open={createFileOpen}
								onClose={() => {
									setCreateFileOpen(false);
								}}
								checkExists={(path) => existsFile(path, fileTree)}
								onConfirm={(path) => {
									setFileTree((fileTree) => createFile(path, fileTree, ""));
									onActivePathChange(path);
									setCreateFileOpen(false);
									setDirty(true);
								}}
							/>
							<DeleteFileDialog
								onConfirm={() => {
									if (!deleteFileOpen) {
										throw new Error("delete file must be set");
									}
									setFileTree((fileTree) =>
										removeFile(deleteFileOpen, fileTree),
									);
									setDeleteFileOpen(undefined);
									if (activePath === deleteFileOpen) {
										onActivePathChange(undefined);
									}
									setDirty(true);
								}}
								open={Boolean(deleteFileOpen)}
								onClose={() => setDeleteFileOpen(undefined)}
								filename={deleteFileOpen || ""}
							/>
							<RenameFileDialog
								fileTree={fileTree}
								open={Boolean(renameFileOpen)}
								onClose={() => {
									setRenameFileOpen(undefined);
								}}
								filename={renameFileOpen || ""}
								checkExists={(path) => existsFile(path, fileTree)}
								onConfirm={(newPath) => {
									if (!renameFileOpen) {
										return;
									}
									setFileTree((fileTree) =>
										moveFile(renameFileOpen, newPath, fileTree),
									);
									onActivePathChange(newPath);
									setRenameFileOpen(undefined);
									setDirty(true);
								}}
							/>
						</div>
						<TemplateFileTree
							fileTree={fileTree}
							onDelete={(file) => setDeleteFileOpen(file)}
							onSelect={(filePath) => {
								if (!isFolder(filePath, fileTree)) {
									onActivePathChange(filePath);
								}
							}}
							onRename={(file) => setRenameFileOpen(file)}
							activePath={activePath}
						/>
					</Sidebar>

					<div
						css={{
							display: "flex",
							flexDirection: "column",
							width: "100%",
							minHeight: "100%",
							overflow: "hidden",
						}}
					>
						<div css={{ flex: 1, overflowY: "auto" }} data-chromatic="ignore">
							{activePath ? (
								isEditorValueBinary ? (
									<div
										role="alert"
										css={{
											width: "100%",
											height: "100%",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											padding: 40,
										}}
									>
										<div
											css={{
												display: "flex",
												flexDirection: "column",
												alignItems: "center",
												maxWidth: 420,
												textAlign: "center",
											}}
										>
											<TriangleAlertIcon
												css={{
													color: theme.roles.warning.fill.outline,
												}}
												className="size-icon-lg"
											/>
											<p
												css={{
													margin: 0,
													padding: 0,
													marginTop: 24,
												}}
											>
												The file is not displayed in the text editor because it
												is either binary or uses an unsupported text encoding.
											</p>
										</div>
									</div>
								) : (
									<MonacoEditor
										value={editorValue}
										path={activePath}
										onChange={(value) => {
											if (!activePath) {
												return;
											}
											setFileTree((fileTree) =>
												updateFile(activePath, value, fileTree),
											);
											setDirty(true);
										}}
									/>
								)
							) : (
								<div>No file opened</div>
							)}
						</div>

						<div
							css={{
								borderTop: `1px solid ${theme.palette.divider}`,
								overflow: "hidden",
								display: "flex",
								flexDirection: "column",
							}}
						>
							<div
								css={{
									display: "flex",
									alignItems: "center",
									borderBottom: selectedTab
										? `1px solid ${theme.palette.divider}`
										: 0,
								}}
							>
								<div
									css={{
										display: "flex",

										"& .MuiTab-root": {
											padding: 0,
											fontSize: 14,
											textTransform: "none",
											letterSpacing: "unset",
										},
									}}
								>
									<button
										type="button"
										disabled={!buildLogs}
										css={styles.tab}
										className={selectedTab === "logs" ? "active" : ""}
										onClick={() => {
											setSelectedTab("logs");
										}}
									>
										Output
									</button>

									<button
										type="button"
										disabled={!canPublish}
										css={styles.tab}
										className={selectedTab === "resources" ? "active" : ""}
										onClick={() => {
											setSelectedTab("resources");
										}}
									>
										Resources
									</button>
								</div>

								{selectedTab && (
									<IconButton
										onClick={() => {
											setSelectedTab(undefined);
										}}
										css={{
											marginLeft: "auto",
											width: 36,
											height: 36,
											borderRadius: 0,
										}}
									>
										<XIcon className="size-icon-xs" />
									</IconButton>
								)}
							</div>

							{selectedTab === "logs" && (
								<div
									css={[styles.logs, styles.tabContent]}
									ref={logsContentRef}
								>
									{templateVersion.job.error ? (
										<div>
											<ProvisionerAlert
												title="Error during the build"
												detail={templateVersion.job.error}
												severity="error"
												tags={templateVersion.job.tags}
												variant={AlertVariant.Inline}
											/>
										</div>
									) : (
										!gotBuildLogs && (
											<>
												<ProvisionerStatusAlert
													matchingProvisioners={matchingProvisioners}
													availableProvisioners={availableProvisioners}
													tags={templateVersion.job.tags}
													variant={AlertVariant.Inline}
												/>
												<Loader css={{ height: "100%" }} />
											</>
										)
									)}

									{gotBuildLogs && (
										<WorkspaceBuildLogs
											css={styles.buildLogs}
											hideTimestamps
											logs={buildLogs}
										/>
									)}
								</div>
							)}

							{selectedTab === "resources" && (
								<div css={[styles.resources, styles.tabContent]}>
									{resources && (
										<TemplateResourcesTable
											resources={resources.filter(
												(r) => r.workspace_transition === "start",
											)}
										/>
									)}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			<PublishTemplateVersionDialog
				key={templateVersion.name}
				publishingError={publishingError}
				open={isAskingPublishParameters || isPublishing}
				onClose={onCancelPublish}
				onConfirm={onConfirmPublish}
				isPublishing={isPublishing}
				defaultName={templateVersion.name}
			/>

			<MissingTemplateVariablesDialog
				open={isPromptingMissingVariables}
				onClose={onCancelSubmitMissingVariableValues}
				onSubmit={onSubmitMissingVariableValues}
				missingVariables={missingVariables}
			/>
		</>
	);
};

const useLeaveSiteWarning = (enabled: boolean) => {
	const MESSAGE =
		"You have unpublished changes. Are you sure you want to leave?";

	// This works for regular browser actions like close tab and back button
	useEffect(() => {
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (enabled) {
				e.preventDefault();
				return MESSAGE;
			}
		};

		window.addEventListener("beforeunload", onBeforeUnload);

		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	}, [enabled]);

	// This is used for react router navigation that is not triggered by the
	// browser
	usePrompt({
		message: MESSAGE,
		when: ({ nextLocation }) => {
			// We need to check the path because we change the URL when new template
			// version is created during builds
			return enabled && !nextLocation.pathname.endsWith("/edit");
		},
	});
};

const styles = {
	tab: (theme) => ({
		"&:not(:disabled)": {
			cursor: "pointer",
		},
		padding: 12,
		fontSize: 10,
		textTransform: "uppercase",
		letterSpacing: "0.5px",
		fontWeight: 500,
		background: "transparent",
		fontFamily: "inherit",
		border: 0,
		color: theme.palette.text.secondary,
		transition: "150ms ease all",
		display: "flex",
		gap: 8,
		alignItems: "center",
		justifyContent: "center",
		position: "relative",

		"& svg": {
			maxWidth: 12,
			maxHeight: 12,
		},

		"&.active": {
			color: theme.palette.text.primary,
			"&:after": {
				content: '""',
				display: "block",
				width: "100%",
				height: 1,
				backgroundColor: theme.palette.primary.main,
				bottom: -1,
				position: "absolute",
			},
		},

		"&:not(:disabled):hover": {
			color: theme.palette.text.primary,
		},

		"&:disabled": {
			color: theme.palette.text.disabled,
		},
	}),

	tabBar: (theme) => ({
		padding: "8px 16px",
		position: "sticky",
		top: 0,
		background: theme.palette.background.default,
		borderBottom: `1px solid ${theme.palette.divider}`,
		color: theme.palette.text.primary,
		textTransform: "uppercase",
		fontSize: 12,

		"&.top": {
			borderTop: `1px solid ${theme.palette.divider}`,
		},
	}),

	tabContent: {
		height: 280,
		overflowY: "auto",
	},

	logs: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
	},

	buildLogs: {
		borderRadius: 0,
		border: 0,

		// Hack to update logs header and lines
		"& .logs-header": {
			border: 0,
			padding: "8px 16px",
			fontFamily: MONOSPACE_FONT_FAMILY,

			"&:first-of-type": {
				paddingTop: 16,
			},

			"&:last-child": {
				paddingBottom: 16,
			},
		},

		"& .logs-line": {
			paddingLeft: 16,
		},

		"& .logs-container": {
			border: "0 !important",
		},
	},

	resources: {
		// Hack to access customize resource-card from here
		"& .resource-card": {
			borderLeft: 0,
			borderRight: 0,

			"&:first-of-type": {
				borderTop: 0,
			},

			"&:last-child": {
				borderBottom: 0,
			},
		},
	},
} satisfies Record<string, Interpolation<Theme>>;
