import { atom } from "jotai";
import {
	BIDSAllFieldsNameType,
	BIDSAllNonMiscFieldsNameType,
	BIDSBooleanColDef,
	BIDSBooleanFieldToColDef,
	BIDSEnumColDef,
	BIDSEnumFieldToColDef,
	BIDSNumericColDef,
	BIDSNumericFieldToColDef,
	BIDSRow,
	BIDSTextColDef,
	BIDSTextFieldToColDef,
	isBIDSBooleanField,
	isBIDSEnumField,
	isBIDSField,
	isBIDSNumericField,
	isBIDSTextField,
	isMiscField,
	MiscColDef,
	MiscFieldToColDef,
} from "../pages/BIDSDataGrid/BIDSColumnDefs";

import { pickBy as lodashPickBy } from "lodash";

import {
	fetchBIDSData,
	parseInvalidFetchItems,
	strictValidateAllBIDSRows,
} from "../pages/BIDSDataGrid/BIDSDataGridFunctions";
import { BIDSErrorAddArg, BIDSErrorMapping } from "../pages/BIDSDataGrid/BIDSErrors";
import { YupValidate } from "../common/utils/formFunctions";
import { Schema_BIDS } from "../common/schemas/BIDSSchema";
import { atomBIDSDatagridSnackbar } from "./SnackbarStore";

const { api } = window;

//^ PRIMITIVE ATOMS

/** Atom that holds a validated filepath which will allow for loading the dataframes from this location */
export const atomBIDSStudyRootPath = atom<string>("D:/GENFI_DF5/Siemens/2D_EPI_M0-Included");

/** Atom that holds the current dataframe data as BIDSRow[] */
export const atomBIDSRows = atom<BIDSRow[]>([]);

/** Atom that holds the current dataframe column names */
export const atomBIDSColumnNames = atom<BIDSAllFieldsNameType[]>([]);

/** Atom that holds the current errors found in the dataframe */
export const atomBIDSErrors = atom<BIDSErrorMapping>({} as BIDSErrorMapping);

/** Primitive atom for controlling the open/closed state of the dialog responsible for adding a new BIDS field */
export const atomBIDSAddColumnDialogOpen = atom(false);

/** Primitive atom for controlling the open/closed state of the dialog responsible for removing a BIDS field */
export const atomBIDSRemoveColumnDialogOpen = atom(false);

// ^ DERIVED ATOMS

/**
 * Derived setter atom for updating the state of the BIDSErrors, either adding or removing errors depending on
 * whether there are any errors in the updateErrorsArg.errors object
 */
export const atomSetBIDSUpdateErrors = atom<null, BIDSErrorAddArg>(null, (get, set, updateErrorsArg) => {
	const { ID, errors: newErrors, bidsRow } = updateErrorsArg;
	const hasErrors = Object.keys(newErrors).length > 0;
	const currentBIDSErrors = get(atomBIDSErrors);

	console.log("🚀 ~ atomSetBIDSUpdateErrors called with debug:", {
		ID,
		bidsRow,
		hasErrors,
		newErrors,
		currentBIDSErrors,
	});

	//* ADDITION OF ERRORS
	if (hasErrors) {
		for (const [fieldName, error] of Object.entries(newErrors)) {
			if (!isBIDSField(fieldName)) continue;

			// If the field already exists in the currentBIDSErrors, then we can just push the new error
			if (fieldName in currentBIDSErrors) {
				currentBIDSErrors[fieldName][ID] = error.message!;
			}
			// Otherwise, we need to create a new entry in the currentBIDSErrors
			else {
				currentBIDSErrors[fieldName] = {
					[ID]: error.message!,
				};
			}
		}

		// Jotai requires that we make a copy in order for the update to register
		const updatedBIDSErrors = { ...currentBIDSErrors };
		console.log("🚀 ~ atomSetBIDSUpdateErrors ~ updatedBIDSErrors after addition", updatedBIDSErrors);
		set(atomBIDSErrors, updatedBIDSErrors);
	}
	//* SUBTRACTION/REMOVAL OF ERRORS
	else {
		const bidsRowFields = new Set(Object.keys(bidsRow));
		const errorKeySet = new Set(Object.keys(newErrors));

		// We need to loop through the fields in the errors rather than through the bidsRow because it is possible that
		// bidsRow does not have all of the fields that are in the errors
		for (const errField of Object.keys(currentBIDSErrors) as BIDSAllFieldsNameType[]) {
			if (bidsRowFields.has(errField)) {
				// If the field is in the bidsRow, then we must:
				// 1) Remove the ID from the error mapping
				if (ID in currentBIDSErrors[errField]) {
					delete currentBIDSErrors[errField][ID];
				}

				// 2) Remove the field if there are no more IDs present for this field
				if (Object.keys(currentBIDSErrors[errField]).length === 0) {
					delete currentBIDSErrors[errField];
					continue;
				}
			} else {
				// If the field is neither in the bidsRow nor in the errors, then we should remove it
				if (!errorKeySet.has(errField)) {
					delete currentBIDSErrors[errField];
					continue;
				}
			}
		}

		// Jotai requires that we make a copy in order for the update to register
		const updatedBIDSErrors = { ...currentBIDSErrors };
		console.log("🚀 ~ atomSetBIDSUpdateErrors ~ updatedBIDSErrors after removal", updatedBIDSErrors);
		set(atomBIDSErrors, updatedBIDSErrors);
	}
});

/** Derived setter atom for setting the dataframe from a given filepath */
export const atomSetFetchBIDSDataFrame = atom<null, string>(null, async (get, set, studyRootPath) => {
	// Sanity check -- must be a valid BIDS study root path
	if (!studyRootPath || !((await api.path.getFilepathType(studyRootPath)) === "dir")) return null;

	console.log("🚀 ~ atomSetFetchBIDSDataFrame ~ studyRootPath", studyRootPath);

	// Clean the fetched data
	const fetchResult = await fetchBIDSData(studyRootPath);
	console.log("🚀 ~ file: BIDSDataGridStore.ts:118 ~ atomSetFetchBIDSDataFrame ~ fetchResult", fetchResult);
	if (!fetchResult) return null;

	const { BIDSRows, BIDSColumns, invalidItems } = fetchResult;
	invalidItems.length > 0 &&
		set(atomBIDSDatagridSnackbar, {
			severity: "error",
			title: "Could not load in one or more ASL BIDS sidecar files",
			message: parseInvalidFetchItems(invalidItems),
		});
	console.log("🚀 ~ file: BIDSDataGridStore.ts:125 ~ atomSetFe	tchBIDSDataFrame ~ invalidFiles", invalidItems);

	const validationErrors = await strictValidateAllBIDSRows(BIDSRows);
	console.log("🚀 ~ file: BIDSDataGridStore.ts:164 ~ atomSetFetchBIDSDataFrame ~ validationErrors", validationErrors);

	// Update the BIDSRows, BIDSColumnNames, and BIDSErrors atoms
	set(atomBIDSRows, BIDSRows);
	set(atomBIDSColumnNames, Array.from(BIDSColumns));
	set(atomBIDSErrors, validationErrors);
	return true;
});

/** Derived getter atom for determining the current column configs to use on the basis of the column names */
export const atomGetBIDSColumnConfigs = atom<
	Array<MiscColDef | BIDSNumericColDef | BIDSBooleanColDef | BIDSTextColDef | BIDSEnumColDef>
>((get) => {
	const colNames = get(atomBIDSColumnNames);
	// console.log("🚀 ~ file: BIDSDataGridStore.ts:55 ~ colNames", colNames);

	const columnConfigs = colNames
		.map((colName) => {
			if (isMiscField(colName)) {
				const config = MiscFieldToColDef[colName];
				return config;
			} else if (isBIDSNumericField(colName)) {
				const config = BIDSNumericFieldToColDef[colName];
				return config;
			} else if (isBIDSTextField(colName)) {
				const config = BIDSTextFieldToColDef[colName];
				return config;
			} else if (isBIDSEnumField(colName)) {
				const config = BIDSEnumFieldToColDef[colName];
				return config;
			} else if (isBIDSBooleanField(colName)) {
				const config = BIDSBooleanFieldToColDef[colName];
				return config;
			} else {
				return null;
			}
		})
		.filter((config) => config !== null);
	return columnConfigs as Array<MiscColDef | BIDSNumericColDef | BIDSBooleanColDef | BIDSTextColDef | BIDSEnumColDef>;
});

type BIDSAddColumnArgs<TName extends BIDSAllFieldsNameType = BIDSAllFieldsNameType> = {
	colToAdd: TName;
	defaultValue: BIDSRow[TName];
};

/** Derived setter atom for adding in a new column to the dataframe */
export const atomSetBIDSAddColumn = atom<null, BIDSAddColumnArgs>(
	null,
	async (get, set, { colToAdd, defaultValue }) => {
		// Update the existing BIDS rows
		const BIDSRows = get(atomBIDSRows);
		const newBIDSRows: BIDSRow[] = BIDSRows.map((row) => ({ ...row, [colToAdd]: defaultValue }));

		// Update the existing BIDS column names
		const BIDSColumnNames = get(atomBIDSColumnNames);
		const newBIDSColumnNames = [...BIDSColumnNames, colToAdd];

		// Update the existing BIDS errors by re-running the validation for all new rows
		const validationErrors = await strictValidateAllBIDSRows(newBIDSRows);

		// Update the atoms
		set(atomBIDSRows, newBIDSRows);
		set(atomBIDSColumnNames, newBIDSColumnNames);
		set(atomBIDSErrors, validationErrors);
	}
);

/** Derived setter atom for removing a given column from the dataframe */
export const atomSetBIDSRemoveColumn = atom(
	null,
	async (get, set, colsToRemove: BIDSAllNonMiscFieldsNameType[] | BIDSAllNonMiscFieldsNameType) => {
		// Type stabiliy
		const colsToRemoveSet = new Set(Array.isArray(colsToRemove) ? colsToRemove : [colsToRemove]);

		// Update the existing BIDS rows
		const BIDSRows = get(atomBIDSRows);
		const newBIDSRows: BIDSRow[] = BIDSRows.map((row) => {
			const newRow = lodashPickBy(
				row,
				(_, key) => !colsToRemoveSet.has(key as BIDSAllNonMiscFieldsNameType)
			) as BIDSRow;
			console.log("🚀 ~ file: BIDSDataGridStore.ts:151 ~ constnewBIDSRows:BIDSRow[]=BIDSRows.map ~ newRow", newRow);
			return newRow;
		});

		// Update the existing BIDS column names
		const BIDSColumnNames = get(atomBIDSColumnNames);
		const newBIDSColumnNames = BIDSColumnNames.filter(
			(colName) => !colsToRemoveSet.has(colName as BIDSAllNonMiscFieldsNameType)
		);

		// Update the existing errors by re-running the validation for all new rows
		// (i.e. it is possible that removing a column will cause a row to become invalid)
		const newBIDSRowErrors = await strictValidateAllBIDSRows(newBIDSRows);

		// Update the atoms
		set(atomBIDSRows, newBIDSRows);
		set(atomBIDSColumnNames, newBIDSColumnNames);
		set(atomBIDSErrors, newBIDSRowErrors);
	}
);

/** Derived setter atom for updating the dataframe from a provided new row */
export const atomSetBIDSUpdateDataFrameFromRow = atom(null, (get, set, newRow: BIDSRow) => {
	const BIDSRows = get(atomBIDSRows);
	const newBIDSRows = BIDSRows.map((row) => (row.ID === newRow.ID ? newRow : row));
	set(atomBIDSRows, newBIDSRows);
});

type BIDSUpdateFromCellArgs<TName extends BIDSAllFieldsNameType = BIDSAllFieldsNameType> = {
	ID: number;
	colName: BIDSAllFieldsNameType;
	value: BIDSRow[TName];
};

/** Derived setter atom for updating the dataframe at a particular cell */
export const atomSetBIDSUpdateDataFrameFromCell = atom<null, BIDSUpdateFromCellArgs>(
	null,
	(get, set, { ID, colName, value }) => {
		const BIDSRows = get(atomBIDSRows);
		const newBIDSRows = BIDSRows.map((row) => (row.ID === ID ? { ...row, [colName]: value } : row));
		set(atomBIDSRows, newBIDSRows);
	}
);