/** The subset of Microsoft Graph v1.0 resources this integration reads and writes. */

export interface GraphCollection<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

export interface GraphUser {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
}

export interface GraphSite {
  id: string;
  displayName?: string;
  webUrl?: string;
}

export interface GraphChoiceColumn {
  allowTextEntry?: boolean;
  choices: string[];
  displayAs?: 'dropDownMenu' | 'radioButtons' | 'checkBoxes';
}

/** A SharePoint column definition. Exactly one type facet is set. */
export interface GraphColumnDefinition {
  id?: string;
  name: string;
  displayName?: string;
  description?: string;
  indexed?: boolean;
  required?: boolean;
  text?: { allowMultipleLines?: boolean; maxLength?: number };
  number?: { decimalPlaces?: 'none' | 'automatic'; minimum?: number };
  dateTime?: { displayAs?: 'default' | 'friendly' | 'standard'; format: 'dateOnly' | 'dateTime' };
  choice?: GraphChoiceColumn;
}

export interface GraphList {
  id: string;
  name?: string;
  displayName: string;
  webUrl?: string;
  list?: { template?: string; hidden?: boolean };
  columns?: GraphColumnDefinition[];
}

export type GraphFieldValue = string | number | boolean | null;
export type GraphFields = Record<string, GraphFieldValue>;

export interface GraphListItem {
  id: string;
  webUrl?: string;
  fields?: GraphFields;
}

/** Shape of the JSON error body Microsoft Graph returns. */
export interface GraphErrorBody {
  error?: {
    code?: string;
    message?: string;
    innerError?: { 'request-id'?: string; date?: string };
  };
}
