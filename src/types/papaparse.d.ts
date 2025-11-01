declare module 'papaparse' {
	export interface ParseError {
		type: string;
		code: string;
		message: string;
		row: number;
	}

	export interface ParseMeta {
		delimiter: string;
		linebreak: string;
		aborted: boolean;
		fields: string[];
		truncated: boolean;
	}

	export interface ParseResult<T> {
		data: T[];
		errors: ParseError[];
		meta: ParseMeta;
	}

	export interface ParseConfig<T> {
		header?: boolean;
		skipEmptyLines?: boolean | 'greedy';
		complete?: (results: ParseResult<T>) => void;
		error?: (error: ParseError) => void;
	}

	export function parse<T>(file: File | string, config: ParseConfig<T>): void;
}
