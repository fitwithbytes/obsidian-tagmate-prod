// Plugin: Tagmate
// Author: fitwithbytes

// Add at the top if @types/js-yaml is not installed
// @ts-ignore
// eslint-disable-next-line
declare module 'js-yaml';

import { App, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, Notice } from "obsidian";
import * as jsyaml from "js-yaml";

interface FolderTagMapping {
	folder: string;
	description?: string; // new: per-mapping description
	tags: { name: string; type: 'inline' | 'yaml' | 'auto' }[];
	filetypes?: string[];
	tagSubfolders?: boolean;
	tagFilesWithoutExtension?: boolean; // new option
	active?: boolean; // new: per-mapping active/inactive
	autoTagNewNotes?: boolean; // new: per-mapping auto-tagging for new notes
}

interface FolderTagMapperSettings {
	mappings: FolderTagMapping[];
	taggingEnabled?: boolean; // new: global enable/disable
}

const DEFAULT_SETTINGS: FolderTagMapperSettings = {
	mappings: [],
	taggingEnabled: true,
};

export default class FolderTagMapperPlugin extends Plugin {
	settings!: FolderTagMapperSettings; // definite assignment assertion

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new FolderTagMapperSettingTab(this.app, this));
		this.registerEvent(this.app.vault.on("create", async (file) => {
			if (file instanceof TFile) {
				await this.tagFile(file);
			}
		}));
		this.addCommand({
			id: "add-tags-to-existing-notes",
			name: "Add tags to existing notes (Tagmate)",
			callback: async () => {
				await this.saveSettings(); // Always save before tagging
				this.app.vault.getMarkdownFiles().forEach((file) => {
					this.tagFile(file);
				});
			}
		});
	}

	async tagFile(file: TFile) {
		if (this.settings.taggingEnabled === false) return; // global disable
		const mappings = this.settings.mappings;
		let fileContent = await this.app.vault.read(file);
		let changed = false;
		let yamlTags: string[] = [];
		let yamlBlockMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n?/);
		let yamlBlock = yamlBlockMatch ? yamlBlockMatch[0] : null;
		let yamlObj: any = {};
		if (yamlBlock) {
			try {
				yamlObj = jsyaml.load(yamlBlock.replace(/^---\n|\n---\n?/g, '')) || {};
				yamlTags = Array.isArray(yamlObj.tags) ? yamlObj.tags : (typeof yamlObj.tags === 'string' ? [yamlObj.tags] : []);
			} catch {}
		}
		for (const mapping of mappings) {
			if (mapping.active === false) continue; // skip inactive mappings
			const folderPath = normalizePath(mapping.folder);
			const filetypes = Array.isArray(mapping.filetypes) && mapping.filetypes.length > 0 ? mapping.filetypes : [];
			const tagSubfolders = mapping.tagSubfolders ?? true;
			const tagFilesWithoutExtension = mapping.tagFilesWithoutExtension ?? false;
			const isRoot = folderPath === '' || folderPath === '/';
			let isInFolder = false;
			if (isRoot) {
				isInFolder = true;
			} else if (tagSubfolders) {
				const allFolders = getAllSubfoldersDeepestFirst(this.app.vault, folderPath);
				isInFolder = allFolders.includes(file.parent?.path ?? '');
			} else {
				isInFolder = file.parent?.path === folderPath;
			}
			const hasNoExt = tagFilesWithoutExtension && !file.name.includes('.')
			if (isInFolder && (hasNoExt || filetypes.length === 0 || filetypes.some(ft => file.path.endsWith(ft)))) {
				for (const tagObj of mapping.tags) {
					const tagPattern = new RegExp(`#${tagObj.name}(\s|$)`, "m");
					const existsInline = tagPattern.test(fileContent);
					const existsYaml = yamlTags.includes(tagObj.name);
					if (existsInline || existsYaml) continue;

					if (tagObj.type === 'inline') {
						fileContent = `#${tagObj.name}\n` + fileContent;
						changed = true;
					} else if (tagObj.type === 'yaml') {
						yamlTags.push(tagObj.name);
						changed = true;
					} else if (tagObj.type === 'auto') {
						if (yamlBlock) {
							yamlTags.push(tagObj.name);
							changed = true;
						} else {
							fileContent = `#${tagObj.name}\n` + fileContent;
							changed = true;
						}
					}
				}
			}
		}
		if (changed) {
			if (yamlBlock) {
				yamlObj.tags = yamlTags;
				const newYaml = '---\n' + jsyaml.dump(yamlObj).trim() + '\n---\n';
				fileContent = fileContent.replace(/^---\n([\s\S]*?)\n---\n?/, newYaml);
			} else if (yamlTags.length > 0) {
				const newYaml = '---\ntags:\n' + yamlTags.map(t => `  - ${t}`).join('\n') + '\n---\n';
				fileContent = newYaml + fileContent;
			}
			await this.app.vault.modify(file, fileContent);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async onunload() {
		await this.saveSettings(); // Save config on unload, like fast-text-color
	}
}

class FolderTagMapperSettingTab extends PluginSettingTab {
	plugin: FolderTagMapperPlugin;
	pendingSave: boolean = false;

	constructor(app: App, plugin: FolderTagMapperPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		// --- GLOBAL CONFIGURATION ---
		containerEl.createEl('h2', { text: 'Tagmate' });

		// Global Configuration Section
		const globalConfigHeaderRow = containerEl.createDiv({ attr: { style: 'display: flex; align-items: center; justify-content: space-between; margin-top: 32px; margin-bottom: 0;' } });
		globalConfigHeaderRow.createEl('h3', { text: 'Global Configuration', attr: { style: 'margin: 0;' } });
		const saveConfigBtn = globalConfigHeaderRow.createEl('button', { text: 'Save Configuration', cls: 'ftb-save-config-btn', attr: { style: 'background: #0074D9; color: #fff; border: none; border-radius: 4px; padding: 6px 16px; font-weight: bold; cursor: pointer; margin-left: 16px; margin-right: 0; margin-left: auto;' } });
		saveConfigBtn.onclick = async () => {
			await this.plugin.saveSettings();
			new Notice('Configuration saved!');
		};
		// Restore thin separator line between Global Configuration and Tag all existing notes now
		containerEl.createEl('hr', { attr: { style: 'border: 0; border-top: 1.5px solid #bbb; margin: 16px 0 16px 0;' } });

		// --- TAG ALL EXISTING NOTES ---
		containerEl.createEl('div', { text: 'Tag all existing notes now', attr: { style: 'font-weight: bold; font-size: 1.1em; margin-bottom: 2px; margin-top: 0;' } });
		// No <hr> or separator here!
		new Setting(containerEl)
			.setDesc("Apply tags to all existing notes in mapped folders.")
			.addButton((btn) => {
				btn.setButtonText("Tag now").onClick(async () => {
					await this.plugin.saveSettings();
					const mappings = this.plugin.settings.mappings;
					const filesToTag: TFile[] = [];
					const filesChecked = new Set<string>();
					for (const mapping of mappings) {
						const folderPath = normalizePath(mapping.folder);
						const filetypes = Array.isArray(mapping.filetypes) && mapping.filetypes.length > 0 ? mapping.filetypes : [".md"];
						const tagSubfolders = mapping.tagSubfolders ?? true;
						const isRoot = folderPath === '' || folderPath === '/';
						let files: TFile[] = [];
						if (isRoot) {
							files = this.plugin.app.vault.getFiles();
						} else if (tagSubfolders) {
							files = getAllFilesDeepestFirst(this.plugin.app.vault, folderPath);
						} else {
							files = this.plugin.app.vault.getFiles().filter(f => f.parent?.path === folderPath);
						}
						for (const file of files) {
							if (!filetypes.some(ft => file.path.endsWith(ft))) continue;
							if (filesChecked.has(file.path)) continue;
							const fileContent = await this.plugin.app.vault.read(file);
							let yamlTags: string[] = [];
							let yamlBlockMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n?/);
							let yamlBlock = yamlBlockMatch ? yamlBlockMatch[0] : null;
							let yamlObj: any = {};
							if (yamlBlock) {
								try {
									yamlObj = jsyaml.load(yamlBlock.replace(/^---\n|\n---\n?/g, '')) || {};
									yamlTags = Array.isArray(yamlObj.tags) ? yamlObj.tags : (typeof yamlObj.tags === 'string' ? [yamlObj.tags] : []);
								} catch {}
							}
							let needsTag = false;
							for (const tag of mapping.tags) {
								const tagPattern = new RegExp(`#${tag.name}(\s|$)`, "m");
								const existsInline = tagPattern.test(fileContent);
								const existsYaml = yamlTags.includes(tag.name);
								if (!existsInline && !existsYaml) {
									needsTag = true;
									break;
								}
							}
							if (needsTag) {
								filesToTag.push(file);
							}
							filesChecked.add(file.path);
						}
					}
					// Remove duplicates
					const uniqueFilesToTag = Array.from(new Set(filesToTag));
					let taggedCount = 0;
					let total = uniqueFilesToTag.length;
					for (let i = 0; i < uniqueFilesToTag.length; i++) {
						const file = uniqueFilesToTag[i];
						await this.plugin.tagFile(file);
						taggedCount++;
						// @ts-ignore
						if ((window as any).Notice) new (window as any).Notice(`Tagging: ${file.path} (${i+1}/${total})`);
						await new Promise(res => setTimeout(res, 50));
					}
					// Final summary notice
					// @ts-ignore
					if ((window as any).Notice) new (window as any).Notice(`Tagged ${taggedCount} notes out of ${total}.`);
				});
			});
		// Remove the thin line under 'Tag all existing notes now' and add a thin line between this and auto-tag new notes
		containerEl.createEl('hr', { attr: { style: 'border: 0; border-top: 1.5px solid #bbb; margin: 16px 0 16px 0;' } });

		// --- AUTO-TAG NEW NOTES ---
		const autoTagSection = containerEl.createDiv({ attr: { style: 'margin-bottom: 24px;' } });
		autoTagSection.createEl('div', { text: 'Auto-tag new notes', attr: { style: 'font-weight: bold; font-size: 1.1em; margin-bottom: 2px;' } });
		autoTagSection.createEl('div', { text: 'Enable or disable auto-tagging for new notes in all mappings at once. Only one option can be active at a time.', attr: { style: 'font-size: 0.95em; color: #666; margin-bottom: 8px;' } });
		const autoTagRow = autoTagSection.createDiv({ attr: { style: 'position: relative; width: 100%; min-height: 40px; margin-bottom: 16px;' } });
		// Enable (left border)
		const enableAutoTagWrapper = autoTagRow.createDiv({ attr: { style: 'position: absolute; left: 0; top: 50%; transform: translateY(-50%); display: flex; align-items: center; justify-content: flex-start; width: 220px;' } });
		const enableAutoTagCheckbox = enableAutoTagWrapper.createEl('input', { type: 'checkbox' });
		enableAutoTagWrapper.createEl('label', { text: 'Enable auto-tag new notes', attr: { style: 'margin-left: 8px;' } });
		// Disable (move a bit more right, keep text on one line)
		const disableAutoTagWrapper = autoTagRow.createDiv({ attr: { style: 'position: absolute; left: 74%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; white-space: nowrap;' } });
		const disableAutoTagCheckbox = disableAutoTagWrapper.createEl('input', { type: 'checkbox' });
		disableAutoTagWrapper.createEl('label', { text: 'Disable auto-tag new notes', attr: { style: 'margin-left: 8px; white-space: nowrap;' } });
		// Only check if all mappings have the property true/false
		const allEnabled = this.plugin.settings.mappings.length > 0 && this.plugin.settings.mappings.every(m => m.autoTagNewNotes === true);
		const allDisabled = this.plugin.settings.mappings.length > 0 && this.plugin.settings.mappings.every(m => m.autoTagNewNotes === false);
		enableAutoTagCheckbox.checked = allEnabled;
		disableAutoTagCheckbox.checked = allDisabled;
		enableAutoTagCheckbox.onchange = async () => {
			if (enableAutoTagCheckbox.checked) {
				disableAutoTagCheckbox.checked = false;
				this.plugin.settings.mappings.forEach(m => m.autoTagNewNotes = true);
				await this.plugin.saveSettings();
				this.display();
			}
		};
		disableAutoTagCheckbox.onchange = async () => {
			if (disableAutoTagCheckbox.checked) {
				enableAutoTagCheckbox.checked = false;
				this.plugin.settings.mappings.forEach(m => m.autoTagNewNotes = false);
				await this.plugin.saveSettings();
				this.display();
			}
		};

		// Add thin separator line after auto-tag new notes section
		containerEl.createEl('hr', { attr: { style: 'border: 0; border-top: 1.5px solid #bbb; margin: 16px 0 16px 0;' } });

		// --- ENABLE/DISABLE ALL MAPPINGS ---
		containerEl.createEl('div', { text: 'Enable/Disable all mappings', attr: { style: 'font-weight: bold; font-size: 1.1em; margin-bottom: 2px; margin-top: 0;' } });
		const enableDisableDesc = containerEl.createDiv();
		enableDisableDesc.textContent = 'Enable or disable all mappings at once. "Enable all mappings" will activate all folder/tag mappings, while "Disable all mappings" will deactivate them.';
		enableDisableDesc.style.marginBottom = '8px';
		enableDisableDesc.style.fontSize = '0.95em';
		enableDisableDesc.style.color = '#666';
		const enableDisableRow = containerEl.createDiv({ attr: { style: 'position: relative; width: 100%; min-height: 40px; margin-bottom: 16px;' } });
		// Enable (left border)
		const enableAllWrapper = enableDisableRow.createDiv({ attr: { style: 'position: absolute; left: 0; top: 50%; transform: translateY(-50%); display: flex; align-items: center; justify-content: flex-start; width: 220px;' } });
		const enableAllSwitch = enableAllWrapper.createEl('input', { type: 'checkbox' });
		enableAllWrapper.createEl('label', { text: 'Enable all mappings', attr: { style: 'margin-left: 8px;' } });
		// Disable (70% from left)
		const disableAllWrapper = enableDisableRow.createDiv({ attr: { style: 'position: absolute; left: 70%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center;' } });
		const disableAllSwitch = disableAllWrapper.createEl('input', { type: 'checkbox' });
		disableAllWrapper.createEl('label', { text: 'Disable all mappings', attr: { style: 'margin-left: 8px;' } });
		// Only check if all mappings have the property true/false
		const enableAll = this.plugin.settings.mappings.length > 0 && this.plugin.settings.mappings.every(m => m.active === true);
		const disableAll = this.plugin.settings.mappings.length > 0 && this.plugin.settings.mappings.every(m => m.active === false);
		enableAllSwitch.checked = enableAll;
		disableAllSwitch.checked = disableAll;
		enableAllSwitch.onchange = async () => {
			if (enableAllSwitch.checked) {
				disableAllSwitch.checked = false;
				this.plugin.settings.mappings.forEach(m => m.active = true);
				await this.plugin.saveSettings();
				this.display();
			}
		};
		disableAllSwitch.onchange = async () => {
			if (disableAllSwitch.checked) {
				enableAllSwitch.checked = false;
				this.plugin.settings.mappings.forEach(m => m.active = false);
				await this.plugin.saveSettings();
				this.display();
			}
		};

		// --- EDIT FOLDER/TAG MAPPINGS ---
		// Add thin separator line before the section header
		containerEl.createEl('hr', { attr: { style: 'border: 0; border-top: 4px solid #bbb; margin: 24px 0 8px 0;' } });
		const mappingsHeaderRow = containerEl.createDiv({ attr: { style: 'display: flex; align-items: center; justify-content: space-between; margin-top: 24px; margin-bottom: 8px;' } });
		mappingsHeaderRow.createEl('h3', { text: 'Edit folder/tag mappings', attr: { style: 'margin: 0;' } });
		const addMappingBtn2 = mappingsHeaderRow.createEl('button', { text: '+ Add Folder Mapping', cls: 'ftb-add-mapping-btn', attr: { style: 'background: #2ecc40; color: #fff; border: none; border-radius: 4px; padding: 6px 16px; font-weight: bold; cursor: pointer; margin-left: 16px;' } });
		addMappingBtn2.onclick = async () => {
			this.plugin.settings.mappings.push({ folder: '', tags: [], active: true });
			await this.plugin.saveSettings();
			this.display();
		};

		// Replace the forEach for mappings with a for loop for better control:
		const mappings = this.plugin.settings.mappings || [];

		mappings.forEach((mapping, idx) => {
			// Section container for each mapping
			const mappingSection = this.containerEl.createDiv({ cls: 'tagmate-mapping-section' });

			// Mapping label (not bold, not oversized)
			const mappingLabel = mappingSection.createDiv({ cls: 'tagmate-mapping-label' });
			mappingLabel.style.display = 'flex';
			mappingLabel.style.alignItems = 'center';
			mappingLabel.style.justifyContent = 'space-between';
			mappingLabel.style.fontWeight = 'normal';
			mappingLabel.style.fontSize = '1em';
			mappingLabel.style.marginBottom = '0.2em';
			mappingLabel.textContent = `Mapping: ${idx + 1}`;

			// Löschen-Button für Mapping
			const deleteMappingBtn = document.createElement('button');
			deleteMappingBtn.textContent = 'Delete mapping';
			deleteMappingBtn.style.background = '#e74c3c';
			deleteMappingBtn.style.color = '#fff';
			deleteMappingBtn.style.border = 'none';
			deleteMappingBtn.style.borderRadius = '4px';
			deleteMappingBtn.style.padding = '4px 12px';
			deleteMappingBtn.style.marginLeft = '16px';
			deleteMappingBtn.style.fontWeight = 'bold';
			deleteMappingBtn.style.cursor = 'pointer';
			deleteMappingBtn.onclick = async () => {
				this.plugin.settings.mappings.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
			};
			mappingLabel.appendChild(deleteMappingBtn);

			// Description input (directly under label)
			const descInput = mappingSection.createEl('input', { type: 'text', cls: 'tagmate-mapping-description-input' });
			descInput.value = mapping.description || '';
			descInput.placeholder = 'Description (optional)';
			descInput.style.display = 'block';
			descInput.style.width = '100%';
			descInput.style.marginBottom = '0.5em';
			descInput.addEventListener('change', async (e) => {
				mapping.description = descInput.value;
				await this.plugin.saveSettings();
			});

			// 1. Active switch
			new Setting(mappingSection)
				.setName('Active')
				.setDesc('Enable or disable this mapping.')
				.addToggle((toggle) => {
					toggle.setValue(mapping.active ?? true)
						.onChange(async (value) => {
							this.plugin.settings.mappings[idx].active = value;
							await this.plugin.saveSettings();
						});
				});

			// After the description input, replace the separate folder/filetype/tag blocks with a flex row:

			// Flex row for folder, filetype, tags
			const mappingRow = mappingSection.createDiv({ cls: 'tagmate-mapping-row' });
			mappingRow.style.display = 'flex';
			mappingRow.style.gap = '24px';
			mappingRow.style.marginBottom = '12px';
			mappingRow.style.alignItems = 'flex-end';

			// Einheitliche Flex-Basis für alle drei Spalten
			const colFlex = '1 1 0';
			const colMinWidth = '0';
			const colMaxWidth = 'none';

			// Folder column
			const folderCol = mappingRow.createDiv({ cls: 'tagmate-mapping-col' });
			folderCol.style.display = 'flex';
			folderCol.style.flexDirection = 'column';
			folderCol.style.flex = colFlex;
			folderCol.style.marginRight = '0';
			folderCol.style.minWidth = colMinWidth;
			folderCol.style.maxWidth = colMaxWidth;
			folderCol.createEl('label', { text: 'Folder', attr: { style: 'font-size: 1em; font-weight: normal; margin-bottom: 2px;' } });
			const folderDropdown = document.createElement('select');
			folderDropdown.style.marginRight = '8px';
			folderDropdown.add(new Option('All files', ''));
			this.getAllFolders().forEach(folder => {
				folderDropdown.add(new Option(folder, folder));
			});
			folderDropdown.value = mapping.folder || '';
			folderDropdown.onchange = async (e) => {
				this.plugin.settings.mappings[idx].folder = folderDropdown.value;
				await this.plugin.saveSettings();
			};
			folderCol.appendChild(folderDropdown);

			// Filetype column
			const filetypeCol = mappingRow.createDiv({ cls: 'tagmate-mapping-col' });
			filetypeCol.style.display = 'flex';
			filetypeCol.style.flexDirection = 'column';
			filetypeCol.style.flex = colFlex;
			filetypeCol.style.marginRight = '0';
			filetypeCol.style.minWidth = colMinWidth;
			filetypeCol.style.maxWidth = colMaxWidth;
			filetypeCol.createEl('label', { text: 'Filetype', attr: { style: 'font-size: 1em; font-weight: normal; margin-bottom: 2px;' } });
			const filetypeInputWrapper = filetypeCol.createDiv();
			filetypeInputWrapper.style.display = 'flex';
			filetypeInputWrapper.style.flexDirection = 'column';
			let mappingFiletypes: string[] = Array.isArray(mapping.filetypes) ? [...mapping.filetypes] : [];
			const filetypeContainer = filetypeInputWrapper.createDiv('ftb-filetype-container');
			filetypeContainer.style.display = 'flex';
			filetypeContainer.style.alignItems = 'center';
			filetypeContainer.style.marginRight = '16px';
			filetypeContainer.innerHTML = '';
			const addFiletypeInput = document.createElement('input');
			addFiletypeInput.type = 'text';
			addFiletypeInput.placeholder = 'Add filetype... (ex. .md)';
			addFiletypeInput.className = 'ftb-filetype-input';
			addFiletypeInput.style.width = '80px';
			addFiletypeInput.onkeydown = async (e) => {
				if (e.key === 'Enter' && addFiletypeInput.value.trim()) {
					e.preventDefault();
					e.stopPropagation();
					let input = addFiletypeInput.value.trim();
					let fts = input.split(/[\,\s\n]+/).map(s => s.trim()).filter(Boolean);
					let added = false;
					for (let ft of fts) {
						if (!mappingFiletypes.includes(ft)) {
							mappingFiletypes.push(ft);
							const ftChip = filetypeContainer.createDiv('ftb-filetype-chip');
							ftChip.setText(ft);
							const removeBtn = document.createElement('button');
							removeBtn.textContent = '×';
							removeBtn.className = 'ftb-filetype-remove';
							removeBtn.onclick = async () => {
								mappingFiletypes = mappingFiletypes.filter(f => f !== ft);
								ftChip.remove();
								this.plugin.settings.mappings[idx].filetypes = [...mappingFiletypes];
								await this.plugin.saveSettings();
							};
							ftChip.appendChild(removeBtn);
							added = true;
						}
					}
					this.plugin.settings.mappings[idx].filetypes = [...mappingFiletypes];
					await this.plugin.saveSettings();
					addFiletypeInput.value = '';
					setTimeout(() => addFiletypeInput.focus(), 0);
				}
			};
			filetypeContainer.appendChild(addFiletypeInput);
			if (Array.isArray(mapping.filetypes)) {
				for (let ft of mapping.filetypes) {
					const ftChip = filetypeContainer.createDiv('ftb-filetype-chip');
					ftChip.setText(ft);
					const removeBtn = document.createElement('button');
					removeBtn.textContent = '×';
					removeBtn.className = 'ftb-filetype-remove';
					removeBtn.onclick = async () => {
						mappingFiletypes = mappingFiletypes.filter(f => f !== ft);
						ftChip.remove();
						this.plugin.settings.mappings[idx].filetypes = [...mappingFiletypes];
						await this.plugin.saveSettings();
					};
					ftChip.appendChild(removeBtn);
				}
			}

			// Tags column
			const tagCol = mappingRow.createDiv({ cls: 'tagmate-mapping-col' });
			tagCol.style.display = 'flex';
			tagCol.style.flexDirection = 'column';
			tagCol.style.flex = colFlex;
			tagCol.style.marginRight = '0';
			tagCol.style.minWidth = colMinWidth;
			tagCol.style.maxWidth = colMaxWidth;
			tagCol.createEl('label', { text: 'Tags', attr: { style: 'font-size: 1em; font-weight: normal; margin-bottom: 2px;' } });
			const tagInputWrapper = tagCol.createDiv();
			tagInputWrapper.style.display = 'flex';
			tagInputWrapper.style.flexDirection = 'column';
			let mappingTags: { name: string, type: 'auto' | 'yaml' | 'inline' }[] = mapping.tags?.map(t => typeof t === 'string' ? { name: t, type: 'auto' } : (t.type ? t : { ...t, type: 'auto' })) || [];
			const tagContainer2 = tagInputWrapper.createDiv('ftb-tag-container');
			tagContainer2.style.display = 'flex';
			tagContainer2.style.alignItems = 'center';
			tagContainer2.innerHTML = '';
			const addTagInput2 = document.createElement('input');
			addTagInput2.type = 'text';
			addTagInput2.placeholder = 'Add tag... (ex. #physics)';
			addTagInput2.className = 'ftb-tag-input';
			addTagInput2.style.width = '100px';
			addTagInput2.onkeydown = async (e) => {
				if (e.key === 'Enter' && addTagInput2.value.trim()) {
					e.preventDefault();
					e.stopPropagation();
					let input = addTagInput2.value.trim();
					let tags = input.split(/[\,\s\n]+/).map(s => s.trim().replace(/^#+/, '')) // Entferne alle führenden #
						.filter(Boolean);
					let added = false;
					for (let tag of tags) {
						if (!mappingTags.some(t => t.name === tag)) {
							mappingTags.push({ name: tag, type: 'auto' });
							const tagChip = tagContainer2.createDiv('ftb-tag-chip');
							tagChip.setText('#' + tag); // Immer genau ein # anzeigen
							// Tag type toggle
							const typeToggle = document.createElement('button');
							typeToggle.textContent = 'Auto';
							typeToggle.className = 'ftb-tag-type-toggle';
							typeToggle.onclick = () => {
								const tagObj = mappingTags.find(t => t.name === tag);
								if (!tagObj) return;
								tagObj.type = tagObj.type === 'auto' ? 'yaml' : tagObj.type === 'yaml' ? 'inline' : 'auto';
								typeToggle.textContent = tagObj.type.charAt(0).toUpperCase() + tagObj.type.slice(1);
								this.plugin.settings.mappings[idx].tags = [...mappingTags];
								this.plugin.saveSettings();
							};
							tagChip.appendChild(typeToggle);
							const removeBtn = document.createElement('button');
							removeBtn.textContent = '×';
							removeBtn.className = 'ftb-tag-remove';
							removeBtn.onclick = async () => {
								mappingTags = mappingTags.filter(t => t.name !== tag);
								tagChip.remove();
								this.plugin.settings.mappings[idx].tags = [...mappingTags];
								await this.plugin.saveSettings();
							};
							tagChip.appendChild(removeBtn);
							added = true;
						}
					}
					this.plugin.settings.mappings[idx].tags = [...mappingTags];
					await this.plugin.saveSettings();
					addTagInput2.value = '';
					setTimeout(() => addTagInput2.focus(), 0);
				}
			};
			tagContainer2.appendChild(addTagInput2);
			if (Array.isArray(mappingTags)) {
				for (let tagObj of mappingTags) {
					const tagChip = tagContainer2.createDiv('ftb-tag-chip');
					tagChip.setText('#' + tagObj.name); // Immer genau ein # anzeigen
					const typeToggle = document.createElement('button');
					typeToggle.textContent = tagObj.type.charAt(0).toUpperCase() + tagObj.type.slice(1);
					typeToggle.className = 'ftb-tag-type-toggle';
					typeToggle.onclick = () => {
						tagObj.type = tagObj.type === 'auto' ? 'yaml' : tagObj.type === 'yaml' ? 'inline' : 'auto';
						typeToggle.textContent = tagObj.type.charAt(0).toUpperCase() + tagObj.type.slice(1);
						this.plugin.settings.mappings[idx].tags = [...mappingTags];
						this.plugin.saveSettings();
					};
					tagChip.appendChild(typeToggle);
					const removeBtn = document.createElement('button');
					removeBtn.textContent = '×';
					removeBtn.className = 'ftb-tag-remove';
					removeBtn.onclick = async () => {
						mappingTags = mappingTags.filter(t => t.name !== tagObj.name);
						tagChip.remove();
						this.plugin.settings.mappings[idx].tags = [...mappingTags];
						await this.plugin.saveSettings();
					};
					tagChip.appendChild(removeBtn);
				}
			}
			// 5. Tag files without extension switch
			new Setting(mappingSection)
				.setName('Tag files without extension')
				.setDesc('If enabled, files without any extension will also be tagged by this mapping.')
				.addToggle((toggle) => {
					toggle.setValue(mapping.tagFilesWithoutExtension ?? false)
						.onChange(async (value) => {
							this.plugin.settings.mappings[idx].tagFilesWithoutExtension = value;
							await this.plugin.saveSettings();
						});
				});
			// 6. Tag subfolders switch
			new Setting(mappingSection)
				.setName('Tag subfolders')
				.setDesc('If enabled, also tag files in subfolders of this folder.')
				.addToggle((toggle) => {
					toggle.setValue(mapping.tagSubfolders ?? true)
						.onChange(async (value) => {
							this.plugin.settings.mappings[idx].tagSubfolders = value;
							await this.plugin.saveSettings();
						});
				});
			// 7. Auto-tag new notes switch (optional, if needed)
			new Setting(mappingSection)
				.setName('Auto-tag new notes')
				.setDesc('Automatically tag new notes created in this folder.')
				.addToggle((toggle) => {
					toggle.setValue(mapping.autoTagNewNotes ?? false)
						.onChange(async (value) => {
							this.plugin.settings.mappings[idx].autoTagNewNotes = value;
							await this.plugin.saveSettings();
						});
				});
			// Add a thin separator line after each mapping
			containerEl.createEl('hr', { attr: { style: 'border: 0; border-top: 1.5px solid #bbb; margin: 16px 0 16px 0;' } });
		});

		// --- REMOVE TAGS ONCE SECTION ---
		// Add a thick separator line above
		containerEl.createEl('hr', { attr: { style: 'border: 0; border-top: 4px solid #e74c3c; margin: 32px 0 8px 0;' } });

		const removeTagsHeaderRow = containerEl.createDiv();
		removeTagsHeaderRow.style.display = 'flex';
		removeTagsHeaderRow.style.alignItems = 'center';
		removeTagsHeaderRow.style.marginBottom = '8px';
		removeTagsHeaderRow.createEl('h3', { text: 'Remove tags once', attr: { style: 'margin: 0;' } });

		const removeTagsSection = containerEl.createDiv({ cls: 'ftb-remove-tags-section' });
		removeTagsSection.style.padding = '16px';
		removeTagsSection.style.border = '2.5px solid #e74c3c';
		removeTagsSection.style.borderRadius = '8px';
		removeTagsSection.style.marginBottom = '32px';
		// Use default background (do not set background)
		removeTagsSection.createEl('div', { text: 'Select a folder, filetypes, and tags to remove from matching files. This action is one-time and does not persist.' });

		// Folder dropdown
		const removeFolderRow = removeTagsSection.createDiv();
		removeFolderRow.style.marginTop = '12px';
		removeFolderRow.style.display = 'flex';
		removeFolderRow.style.alignItems = 'center';
		const folderLabel = removeFolderRow.createEl('span', { text: 'Folder:' });
		folderLabel.style.marginRight = '8px';
		folderLabel.style.minWidth = '60px';
		const removeFolderDropdown = document.createElement('select');
		removeFolderDropdown.style.marginRight = '16px';
		removeFolderDropdown.add(new Option('All files', ''));
		this.getAllFolders().forEach(folder => {
			removeFolderDropdown.add(new Option(folder, folder));
		});
		removeFolderRow.appendChild(removeFolderDropdown);

		// Filetype chips (multi)
		const filetypeLabel = removeFolderRow.createEl('span', { text: 'Filetypes:' });
		filetypeLabel.style.marginRight = '8px';
		filetypeLabel.style.minWidth = '70px';
		const filetypeContainer = removeFolderRow.createDiv('ftb-filetype-container');
		filetypeContainer.style.display = 'flex';
		filetypeContainer.style.alignItems = 'center';
		filetypeContainer.style.marginRight = '16px';
		let removeFiletypes: string[] = [];
		filetypeContainer.innerHTML = '';
		const addFiletypeInput = document.createElement('input');
		addFiletypeInput.type = 'text';
		addFiletypeInput.placeholder = '.md';
		addFiletypeInput.className = 'ftb-filetype-input';
		addFiletypeInput.style.width = '80px';
		addFiletypeInput.onkeydown = (e) => {
			if (e.key === 'Enter' && addFiletypeInput.value.trim()) {
				e.preventDefault();
				e.stopPropagation();
				let input = addFiletypeInput.value.trim();
				let fts = input.split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean);
				for (let ft of fts) {
					if (!removeFiletypes.includes(ft)) {
						removeFiletypes.push(ft);
						const ftChip = filetypeContainer.createDiv('ftb-filetype-chip');
						ftChip.setText(ft);
						const removeBtn = document.createElement('button');
						removeBtn.textContent = '×';
						removeBtn.className = 'ftb-filetype-remove';
						removeBtn.onclick = () => {
							removeFiletypes = removeFiletypes.filter(f => f !== ft);
							ftChip.remove();
						};
						ftChip.appendChild(removeBtn);
					}
				}
				addFiletypeInput.value = '';
			}
		};
		filetypeContainer.appendChild(addFiletypeInput);

		// Tag chips (multi)
		const tagLabel = removeFolderRow.createEl('span', { text: 'Tags:' });
		tagLabel.style.marginRight = '8px';
		tagLabel.style.minWidth = '40px';
		const tagContainer = removeFolderRow.createDiv('ftb-tag-container');
		tagContainer.style.display = 'flex';
		tagContainer.style.alignItems = 'center';
		tagContainer.style.marginRight = '16px';
		let removeTags: { name: string, type: 'auto' | 'yaml' | 'inline' }[] = [];
		tagContainer.innerHTML = '';
		const addTagInput = document.createElement('input');
		addTagInput.type = 'text';
		addTagInput.placeholder = '#tag';
		addTagInput.className = 'ftb-tag-input';
		addTagInput.style.width = '100px';
		addTagInput.onkeydown = (e) => {
			if (e.key === 'Enter' && addTagInput.value.trim()) {
				e.preventDefault();
				e.stopPropagation();
				let input = addTagInput.value.trim();
				let tags = input.split(/[\,\s\n]+/).map(s => s.trim().replace(/^#+/, '')) // Entferne alle führenden #
					.filter(Boolean);
				for (let tag of tags) {
					if (!removeTags.some(t => t.name === tag)) {
						removeTags.push({ name: tag, type: 'auto' });
						const tagChip = tagContainer.createDiv('ftb-tag-chip');
						tagChip.setText('#' + tag); // Immer genau ein # anzeigen
						// Tag type toggle
						const typeToggle = document.createElement('button');
						typeToggle.textContent = 'Auto';
						typeToggle.className = 'ftb-tag-type-toggle';
						typeToggle.onclick = () => {
							const tagObj = removeTags.find(t => t.name === tag);
							if (!tagObj) return;
							tagObj.type = tagObj.type === 'auto' ? 'yaml' : tagObj.type === 'yaml' ? 'inline' : 'auto';
							typeToggle.textContent = tagObj.type.charAt(0).toUpperCase() + tagObj.type.slice(1);
						};
						tagChip.appendChild(typeToggle);
						const removeBtn = document.createElement('button');
						removeBtn.textContent = '×';
						removeBtn.className = 'ftb-tag-remove';
						removeBtn.onclick = () => {
							removeTags = removeTags.filter(t => t.name !== tag);
							tagChip.remove();
						};
						tagChip.appendChild(removeBtn);
					}
				}
				addTagInput.value = '';
				setTimeout(() => addTagInput.focus(), 0);
			}
		};
		tagContainer.appendChild(addTagInput);
		// Chips für bestehende removeTags anzeigen (falls nötig)
		if (Array.isArray(removeTags)) {
			for (let tagObj of removeTags) {
				const tagChip = tagContainer.createDiv('ftb-tag-chip');
				tagChip.setText('#' + tagObj.name); // Immer genau ein # anzeigen
				const typeToggle = document.createElement('button');
				typeToggle.textContent = tagObj.type.charAt(0).toUpperCase() + tagObj.type.slice(1);
				typeToggle.className = 'ftb-tag-type-toggle';
				typeToggle.onclick = () => {
					tagObj.type = tagObj.type === 'auto' ? 'yaml' : tagObj.type === 'yaml' ? 'inline' : 'auto';
					typeToggle.textContent = tagObj.type.charAt(0).toUpperCase() + tagObj.type.slice(1);
				};
				tagChip.appendChild(typeToggle);
				const removeBtn = document.createElement('button');
				removeBtn.textContent = '×';
				removeBtn.className = 'ftb-tag-remove';
				removeBtn.onclick = () => {
					removeTags = removeTags.filter(t => t.name !== tagObj.name);
					tagChip.remove();
				};
				tagChip.appendChild(removeBtn);
			}
		}

		// Add toggles below the removeFolderRow in Remove tags once section
		const togglesRow = removeTagsSection.createDiv();
		togglesRow.style.display = 'flex';
		togglesRow.style.alignItems = 'center';
		togglesRow.style.marginTop = '12px';

		// Include subfolders toggle
		const subfoldersLabel = togglesRow.createEl('span', { text: 'Include subfolders:' });
		subfoldersLabel.style.marginRight = '8px';
		const subfoldersToggle = document.createElement('input');
		subfoldersToggle.type = 'checkbox';
		subfoldersToggle.checked = true;
		subfoldersToggle.style.marginRight = '24px';
		togglesRow.appendChild(subfoldersLabel);
		togglesRow.appendChild(subfoldersToggle);

		// Tag files without extension toggle
		const noExtLabel = togglesRow.createEl('span', { text: 'Tag files without extension:' });
		noExtLabel.style.marginRight = '8px';
		const noExtToggle = document.createElement('input');
		noExtToggle.type = 'checkbox';
		noExtToggle.checked = false;
		togglesRow.appendChild(noExtLabel);
		togglesRow.appendChild(noExtToggle);

		// --- Move the delete button to its own row at the bottom, aligned left ---
		const deleteBtnRow = removeTagsSection.createDiv();
		deleteBtnRow.style.display = 'flex';
		deleteBtnRow.style.justifyContent = 'flex-start';
		deleteBtnRow.style.marginTop = '24px';

		const removeTagBtn = document.createElement('button');
		removeTagBtn.textContent = '';
		removeTagBtn.innerHTML = 'Delete these<br>tags now';
		removeTagBtn.style.whiteSpace = 'normal';
		removeTagBtn.style.lineHeight = '1.2';
		removeTagBtn.style.padding = '18px 12px'; // Increased vertical padding
		removeTagBtn.style.minWidth = '80px';
		removeTagBtn.style.minHeight = '48px'; // Ensure enough height for two lines
		removeTagBtn.style.display = 'flex';
		removeTagBtn.style.flexDirection = 'column';
		removeTagBtn.style.justifyContent = 'center';
		removeTagBtn.style.alignItems = 'center';
		removeTagBtn.style.background = '#e74c3c';
		removeTagBtn.style.color = '#fff';
		removeTagBtn.style.border = 'none';
		removeTagBtn.style.borderRadius = '4px';
		removeTagBtn.style.fontWeight = 'bold';
		removeTagBtn.style.cursor = 'pointer';
		removeTagBtn.onclick = async () => {
			if (removeTags.length === 0) return;
			const folderPath = normalizePath(removeFolderDropdown.value);
			const filetypes = removeFiletypes.length > 0 ? removeFiletypes : ['.md'];
			const includeSubfolders = subfoldersToggle.checked;
			const tagFilesWithoutExtension = noExtToggle.checked;
			const isRoot = folderPath === '' || folderPath === '/';
			let files = [];
			if (isRoot) {
				files = this.plugin.app.vault.getFiles();
			} else if (includeSubfolders) {
				files = getAllFilesDeepestFirst(this.plugin.app.vault, folderPath);
			} else {
				files = this.plugin.app.vault.getFiles().filter(f => f.parent?.path === folderPath);
			}
			let deletedCount = 0;
			for (const file of files) {
				const hasNoExt = tagFilesWithoutExtension && !file.name.includes('.')
				if (!(hasNoExt || filetypes.some(ft => file.path.endsWith(ft)))) continue;
				let fileContent = await this.plugin.app.vault.read(file);
				let changed = false;
				// Entferne Inline-Tags
				for (const tag of removeTags) {
					const tagPattern = new RegExp(`#${tag.name}(\s|$)`, 'gm');
					if (tagPattern.test(fileContent)) {
						fileContent = fileContent.replace(tagPattern, '');
						changed = true;
					}
				}
				// Entferne aus YAML frontmatter (auto oder yaml)
				let yamlBlockMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n?/);
				if (yamlBlockMatch) {
					let yamlBlock = yamlBlockMatch[0];
					let yamlObj = {} as any;
					try {
						yamlObj = jsyaml.load(yamlBlock.replace(/^---\n|\n---\n?/g, '')) || {};
						if (yamlObj.tags) {
							let tagsArr = Array.isArray(yamlObj.tags) ? [...yamlObj.tags] : (typeof yamlObj.tags === 'string' ? [yamlObj.tags] : []);
							const tagsToRemove = removeTags.map(rt => rt.name);
							const filteredTags = tagsArr.filter((t: string) => !tagsToRemove.includes(t));
							if (filteredTags.length !== tagsArr.length) {
								if (filteredTags.length > 0) {
									yamlObj.tags = filteredTags;
								} else {
									delete yamlObj.tags;
								}
								const newYaml = '---\n' + jsyaml.dump(yamlObj, { lineWidth: -1 }).replace(/\n+$/, '') + '\n---\n';
								fileContent = fileContent.replace(yamlBlock, newYaml);
								changed = true;
							}
						}
					} catch (e) {
						console.error('YAML tag removal error:', e);
					}
				}
				if (changed) {
					await this.plugin.app.vault.modify(file, fileContent);
					deletedCount++;
				}
			}
			// @ts-ignore
			if ((window as any).Notice) new (window as any).Notice(`Deleted selected tags from ${deletedCount} notes.`);
			addTagInput.value = '';
			tagContainer.querySelectorAll('.ftb-tag-chip').forEach(chip => chip.remove());
			removeTags.length = 0;
		};
		deleteBtnRow.appendChild(removeTagBtn);
	}

	getAllFolders(): string[] {
		const folders = new Set<string>();
		const files = this.app.vault.getAllLoadedFiles();
		for (const file of files) {
			if (file instanceof TFolder) {
				folders.add(file.path);
			}
		}
		return Array.from(folders).sort();
	}
}

// Helper: Recursively collect all subfolders (deepest first)
function getAllSubfoldersDeepestFirst(vault: App["vault"], baseFolder: string): string[] {
	const folders: string[] = [];
	function recurse(folderPath: string) {
		const subfolders = vault.getAllLoadedFiles().filter(f => f instanceof TFolder && f.parent && f.parent.path === folderPath).map(f => f.path);
		for (const sub of subfolders) {
			recurse(sub);
		}
		folders.push(folderPath);
	}
	recurse(baseFolder);
	return folders;
}

function getAllFilesDeepestFirst(vault: App["vault"], baseFolder: string): TFile[] {
	const folders = getAllSubfoldersDeepestFirst(vault, baseFolder);
	const files: TFile[] = [];
	for (const folder of folders) {
		const folderFiles = vault.getAllLoadedFiles().filter(f => f instanceof TFile && f.parent?.path === folder) as TFile[];
		files.push(...folderFiles);
	}
	return files;
}
