/// <reference types="node" />
import { Readable } from 'stream';
import IGeometry, { IEntity, IPoint } from './entities/geomtry';
export interface IBlock {
    entities: IEntity[];
    type: number;
    ownerHandle: string;
    xrefPath: string;
    name: string;
    name2: string;
    handle: string;
    layer: string;
    position: IPoint;
    paperSpace: boolean;
}
export interface IViewPort {
    name: string;
    lowerLeftCorner: IPoint;
    upperRightCorner: IPoint;
    center: IPoint;
    snapBasePoint: IPoint;
    snapSpacing: IPoint;
    gridSpacing: IPoint;
    viewDirectionFromTarget: IPoint;
    viewTarget: IPoint;
    lensLength: number;
    frontClippingPlane: string | number | boolean;
    backClippingPlane: string | number | boolean;
    viewHeight: number;
    snapRotationAngle: number;
    viewTwistAngle: number;
    orthographicType: string;
    ucsOrigin: IPoint;
    ucsXAxis: IPoint;
    ucsYAxis: IPoint;
    renderMode: string;
    defaultLightingType: string;
    defaultLightingOn: string;
    ownerHandle: string;
    ambientColor: number;
}
export interface IViewPortTableDefinition {
    tableRecordsProperty: 'viewPorts';
    tableName: 'viewPort';
    dxfSymbolName: 'VPORT';
    parseTableRecords(): IViewPort[];
}
export interface ILineType {
    name: string;
    description: string;
    pattern: string[];
    patternLength: number;
}
export interface ILineTypeTableDefinition {
    tableRecordsProperty: 'lineTypes';
    tableName: 'lineType';
    dxfSymbolName: 'LTYPE';
    parseTableRecords(): Record<string, ILineType>;
}
export interface ILayer {
    name: string;
    visible: boolean;
    colorIndex: number;
    color: number;
    frozen: boolean;
}
export interface ILayerTableDefinition {
    tableRecordsProperty: 'layers';
    tableName: 'layer';
    dxfSymbolName: 'LAYER';
    parseTableRecords(): Record<string, ILayer>;
}
export interface ITableDefinitions {
    VPORT: IViewPortTableDefinition;
    LTYPE: ILineTypeTableDefinition;
    LAYER: ILayerTableDefinition;
}
export interface IBaseTable {
    handle: string;
    ownerHandle: string;
}
export interface IViewPortTable extends IBaseTable {
    viewPorts: IViewPort[];
}
export interface ILayerTypesTable extends IBaseTable {
    lineTypes: Record<string, ILineType>;
}
export interface ILayersTable extends IBaseTable {
    layers: Record<string, ILayer>;
}
export interface ITables {
    viewPort: IViewPortTable;
    lineType: ILayerTypesTable;
    layer: ILayersTable;
}
export declare type ITable = IViewPortTable | ILayerTypesTable | ILayersTable;
export interface IDxf {
    header: Record<string, IPoint | number>;
    entities: IEntity[];
    blocks: Record<string, IBlock>;
    tables: ITables;
}
export default class DxfParser {
    private _entityHandlers;
    constructor();
    parse(source: string): IDxf | null;
    registerEntityHandler(handlerType: new () => IGeometry): void;
    parseSync(source: string): IDxf | null;
    parseStream(stream: Readable): Promise<IDxf>;
    private _parse;
}
