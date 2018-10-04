// @flow
/* eslint-env browser */

import { GeoJsonLayer, ScatterplotLayer, IconLayer } from 'deck.gl';
import { EditableFeatureCollection } from '../editable-feature-collection.js';
import type { EditAction } from '../editable-feature-collection.js';
import type { Feature, Position } from '../../geojson-types.js';
import EditableLayer from './editable-layer.js';
import type {
  ClickEvent,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent
} from './editable-layer.js';

const DEFAULT_LINE_COLOR = [0x0, 0x0, 0x0, 0xff];
const DEFAULT_FILL_COLOR = [0x0, 0x0, 0x0, 0x90];
const DEFAULT_SELECTED_LINE_COLOR = [0x90, 0x90, 0x90, 0xff];
const DEFAULT_SELECTED_FILL_COLOR = [0x90, 0x90, 0x90, 0x90];
const DEFAULT_EDITING_EXISTING_POINT_COLOR = [0xc0, 0x0, 0x0, 0xff];
const DEFAULT_EDITING_INTERMEDIATE_POINT_COLOR = [0x0, 0x0, 0x0, 0x80];

const defaultProps = {
  mode: 'modify',

  // Edit and interaction events
  onEdit: () => {},

  pickable: true,
  fp64: false,
  filled: true,
  stroked: true,
  lineWidthScale: 1,
  lineWidthMinPixels: 1,
  lineWidthMaxPixels: Number.MAX_SAFE_INTEGER,
  lineJointRounded: false,
  lineMiterLimit: 4,
  pointRadiusScale: 1,
  pointRadiusMinPixels: 2,
  pointRadiusMaxPixels: Number.MAX_SAFE_INTEGER,
  lineDashJustified: false,
  drawAtFront: false,
  getLineColor: (feature, isSelected, mode) =>
    isSelected ? DEFAULT_SELECTED_LINE_COLOR : DEFAULT_LINE_COLOR,
  getFillColor: (feature, isSelected, mode) =>
    isSelected ? DEFAULT_SELECTED_FILL_COLOR : DEFAULT_FILL_COLOR,
  getRadius: f =>
    (f && f.properties && f.properties.radius) || (f && f.properties && f.properties.size) || 1,
  getLineWidth: f => (f && f.properties && f.properties.lineWidth) || 1,
  getLineDashArray: (feature, isSelected, mode) =>
    isSelected && mode !== 'view' ? [7, 4] : [0, 0],

  // Tentative feature rendering
  getTentativeLineDashArray: (f, mode) => [7, 4],
  getTentativeLineColor: (f, mode) => DEFAULT_SELECTED_LINE_COLOR,
  getTentativeFillColor: (f, mode) => DEFAULT_SELECTED_FILL_COLOR,
  getTentativeLineWidth: (f, mode) => (f && f.properties && f.properties.lineWidth) || 1,

  editHandleType: 'point',
  editHandleParameters: {},

  // point handles
  editHandlePointRadiusScale: 1,
  editHandlePointOutline: false,
  editHandlePointStrokeWidth: 1,
  editHandlePointRadiusMinPixels: 4,
  editHandlePointRadiusMaxPixels: 8,
  getEditHandlePointColor: handle =>
    handle.type === 'existing'
      ? DEFAULT_EDITING_EXISTING_POINT_COLOR
      : DEFAULT_EDITING_INTERMEDIATE_POINT_COLOR,
  getEditHandlePointRadius: handle => (handle.type === 'existing' ? 5 : 3),

  // icon handles
  editHandleIconAtlas: null,
  editHandleIconMapping: null,
  editHandleIconSizeScale: 1,
  getEditHandleIcon: handle => handle.type,
  getEditHandleIconSize: 10,
  getEditHandleIconColor: handle =>
    handle.type === 'existing'
      ? DEFAULT_EDITING_EXISTING_POINT_COLOR
      : DEFAULT_EDITING_INTERMEDIATE_POINT_COLOR,
  getEditHandleIconAngle: 0
};

type Props = {
  onEdit: EditAction => void,
  // TODO
  [string]: any
};

type State = {
  editableFeatureCollection: EditableFeatureCollection,
  tentativeFeature: ?Feature,
  editHandles: any[],
  selectedFeatures: Feature[],
  pointerMovePicks: any[]
};

export default class EditableGeoJsonLayer extends EditableLayer {
  // state: State;

  // props: Props;

  // setState: ($Shape<State>) => void;

  renderLayers() {
    const subLayerProps = this.getSubLayerProps({
      id: 'geojson',

      // Proxy most GeoJsonLayer props as-is
      data: this.props.data,
      fp64: this.props.fp64,
      filled: this.props.filled,
      stroked: this.props.stroked,
      lineWidthScale: this.props.lineWidthScale,
      lineWidthMinPixels: this.props.lineWidthMinPixels,
      lineWidthMaxPixels: this.props.lineWidthMaxPixels,
      lineJointRounded: this.props.lineJointRounded,
      lineMiterLimit: this.props.lineMiterLimit,
      pointRadiusScale: this.props.pointRadiusScale,
      pointRadiusMinPixels: this.props.pointRadiusMinPixels,
      pointRadiusMaxPixels: this.props.pointRadiusMaxPixels,
      lineDashJustified: this.props.lineDashJustified,
      getLineColor: this.selectionAwareAccessor(this.props.getLineColor),
      getFillColor: this.selectionAwareAccessor(this.props.getFillColor),
      getRadius: this.selectionAwareAccessor(this.props.getRadius),
      getLineWidth: this.selectionAwareAccessor(this.props.getLineWidth),
      getLineDashArray: this.selectionAwareAccessor(this.props.getLineDashArray),

      updateTriggers: {
        getLineColor: [this.props.selectedFeatureIndexes, this.props.mode],
        getFillColor: [this.props.selectedFeatureIndexes, this.props.mode],
        getRadius: [this.props.selectedFeatureIndexes, this.props.mode],
        getLineWidth: [this.props.selectedFeatureIndexes, this.props.mode],
        getLineDashArray: [this.props.selectedFeatureIndexes, this.props.mode]
      }
    });

    let layers: any = [new GeoJsonLayer(subLayerProps)];

    layers = layers.concat(this.createTentativeLayers());
    layers = layers.concat(this.createEditHandleLayers());

    return layers;
  }

  initializeState() {
    super.initializeState();

    this.setState({
      editableFeatureCollection: new EditableFeatureCollection({
        type: 'FeatureCollection',
        features: []
      }),
      selectedFeatures: [],
      editHandles: []
    });
  }

  // TODO: figure out how to properly update state from an outside event handler
  shouldUpdateState({ props, oldProps, context, oldContext, changeFlags }: Object) {
    if (changeFlags.stateChanged) {
      return true;
    }
    return true;
  }

  updateState({
    props,
    oldProps,
    changeFlags
  }: {
    props: Props,
    oldProps: Props,
    changeFlags: any
  }) {
    super.updateState({ props, changeFlags });

    const editableFeatureCollection = this.state.editableFeatureCollection;
    if (changeFlags.dataChanged) {
      editableFeatureCollection.setFeatureCollection(props.data);
    }

    if (changeFlags.propsOrDataChanged) {
      editableFeatureCollection.setMode(props.mode);
      editableFeatureCollection.setModeConfig(props.modeConfig);
      editableFeatureCollection.setSelectedFeatureIndexes(props.selectedFeatureIndexes);
      editableFeatureCollection.setDrawAtFront(props.drawAtFront);
      this.updateTentativeFeature();
      this.updateEditHandles();
    }

    let selectedFeatures = [];
    if (Array.isArray(props.selectedFeatureIndexes)) {
      // TODO: needs improved testing, i.e. checking for duplicates, NaNs, out of range numbers, ...
      selectedFeatures = props.selectedFeatureIndexes.map(elem => props.data.features[elem]);
    }

    this.setState({ selectedFeatures });
  }

  selectionAwareAccessor(accessor: any) {
    if (typeof accessor !== 'function') {
      return accessor;
    }
    return (feature: Object) => accessor(feature, this.isFeatureSelected(feature), this.props.mode);
  }

  isFeatureSelected(feature: Object) {
    if (!this.props.data || !this.props.selectedFeatureIndexes) {
      return false;
    }
    if (!this.props.selectedFeatureIndexes.length) {
      return false;
    }
    const featureIndex = this.props.data.features.indexOf(feature);
    return this.props.selectedFeatureIndexes.includes(featureIndex);
  }

  getPickingInfo({ info, sourceLayer }: Object) {
    if (sourceLayer.id.endsWith('-edit-handles')) {
      // If user is picking an editing handle, add additional data to the info
      info.isEditingHandle = true;
    }

    return info;
  }

  createEditHandleLayers() {
    if (!this.state.editHandles.length) {
      return [];
    }

    const sharedProps = {
      id: `${this.props.editHandleType}-edit-handles`,
      data: this.state.editHandles,
      fp64: this.props.fp64
    };

    const layer =
      this.props.editHandleType === 'icon'
        ? new IconLayer(
            this.getSubLayerProps({
              ...sharedProps,
              iconAtlas: this.props.editHandleIconAtlas,
              iconMapping: this.props.editHandleIconMapping,
              sizeScale: this.props.editHandleIconSizeScale,
              getIcon: this.props.getEditHandleIcon,
              getSize: this.props.getEditHandleIconSize,
              getColor: this.props.getEditHandleIconColor,
              getAngle: this.props.getEditHandleIconAngle,

              getPosition: d => d.position,

              parameters: this.props.editHandleParameters
            })
          )
        : this.props.editHandleType === 'point'
          ? new ScatterplotLayer(
              this.getSubLayerProps({
                ...sharedProps,

                // Proxy editing point props
                radiusScale: this.props.editHandlePointRadiusScale,
                outline: this.props.editHandlePointOutline,
                strokeWidth: this.props.editHandlePointStrokeWidth,
                radiusMinPixels: this.props.editHandlePointRadiusMinPixels,
                radiusMaxPixels: this.props.editHandlePointRadiusMaxPixels,
                getRadius: this.props.getEditHandlePointRadius,
                getColor: this.props.getEditHandlePointColor,

                parameters: this.props.editHandleParameters
              })
            )
          : null;

    return [layer];
  }

  createTentativeLayers() {
    if (!this.state.tentativeFeature) {
      return [];
    }

    const layer = new GeoJsonLayer(
      this.getSubLayerProps({
        id: 'tentative',
        data: this.state.tentativeFeature,
        fp64: this.props.fp64,
        pickable: false,
        stroked: true,
        autoHighlight: false,
        lineWidthScale: this.props.lineWidthScale,
        lineWidthMinPixels: this.props.lineWidthMinPixels,
        lineWidthMaxPixels: this.props.lineWidthMaxPixels,
        lineJointRounded: this.props.lineJointRounded,
        lineMiterLimit: this.props.lineMiterLimit,
        pointRadiusScale: this.props.editHandlePointRadiusScale,
        outline: this.props.editHandlePointOutline,
        strokeWidth: this.props.editHandlePointStrokeWidth,
        pointRadiusMinPixels: this.props.editHandlePointRadiusMinPixels,
        pointRadiusMaxPixels: this.props.editHandlePointRadiusMaxPixels,
        getRadius: this.props.getEditHandlePointRadius,
        getLineColor: feature => this.props.getTentativeLineColor(feature, this.props.mode),
        getLineWidth: feature => this.props.getTentativeLineWidth(feature, this.props.mode),
        getFillColor: feature => this.props.getTentativeFillColor(feature, this.props.mode),
        getLineDashArray: feature =>
          this.props.getTentativeLineDashArray(
            feature,
            this.state.selectedFeatures[0],
            this.props.mode
          )
      })
    );

    return [layer];
  }

  updateTentativeFeature() {
    const tentativeFeature = this.state.editableFeatureCollection.getTentativeFeature();
    if (tentativeFeature !== this.state.tentativeFeature) {
      this.setState({ tentativeFeature });
      this.setLayerNeedsUpdate();
    }
  }

  updateEditHandles(picks?: Array<Object>, groundCoords?: Position) {
    const editHandles = this.state.editableFeatureCollection.getEditHandles(picks, groundCoords);
    if (editHandles !== this.state.editHandles) {
      this.setState({ editHandles });
      this.setLayerNeedsUpdate();
    }
  }

  onClick({ groundCoords, picks }: ClickEvent) {
    const editAction = this.state.editableFeatureCollection.onClick(groundCoords, picks);
    this.updateTentativeFeature();
    this.updateEditHandles();

    if (editAction) {
      this.props.onEdit(editAction);
    }
  }

  onStartDragging({
    picks,
    screenCoords,
    groundCoords,
    dragStartScreenCoords,
    dragStartGroundCoords
  }: StartDraggingEvent) {
    const editAction = this.state.editableFeatureCollection.onStartDragging(picks, groundCoords);
    this.updateTentativeFeature();
    this.updateEditHandles();

    if (editAction) {
      this.props.onEdit(editAction);
    }
  }

  onStopDragging({
    picks,
    screenCoords,
    groundCoords,
    dragStartScreenCoords,
    dragStartGroundCoords
  }: StopDraggingEvent) {
    const editAction = this.state.editableFeatureCollection.onStopDragging(picks, groundCoords);
    this.updateTentativeFeature();
    this.updateEditHandles();

    if (editAction) {
      this.props.onEdit(editAction);
    }
  }

  onPointerMove({
    groundCoords,
    picks,
    isDragging,
    dragStartPicks,
    dragStartGroundCoords,
    sourceEvent
  }: PointerMoveEvent) {
    this.setState({ pointerMovePicks: picks });

    const { editAction, cancelMapPan } = this.state.editableFeatureCollection.onPointerMove(
      groundCoords,
      picks,
      isDragging,
      dragStartPicks,
      dragStartGroundCoords
    );
    this.updateTentativeFeature();
    this.updateEditHandles(picks, groundCoords);

    if (cancelMapPan) {
      // TODO: find a less hacky way to prevent map panning
      // Stop propagation to prevent map panning while dragging an edit handle
      sourceEvent.stopPropagation();
    }

    if (editAction) {
      this.props.onEdit(editAction);
    }
  }

  getPickedEditHandle(picks: Object[]) {
    return picks.find(pick => pick.isEditingHandle);
  }

  getCursor({ isDragging }: { isDragging: boolean }) {
    const mode = this.props.mode;
    if (mode.startsWith('draw')) {
      return 'cell';
    }

    const picks = this.state.pointerMovePicks;
    if (mode === 'modify' && picks && picks.length > 0) {
      const existingHandlePicked = picks.some(
        pick => pick.isEditingHandle && pick.object.type === 'existing'
      );
      const intermediateHandlePicked = picks.some(
        pick => pick.isEditingHandle && pick.object.type === 'intermediate'
      );
      if (existingHandlePicked) {
        // return 'move';
        // return `url("data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3Csvg width='32' height='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1639 1056q0 5-1 7-64 268-268 434.5t-478 166.5q-146 0-282.5-55t-243.5-157l-129 129q-19 19-45 19t-45-19-19-45v-448q0-26 19-45t45-19h448q26 0 45 19t19 45-19 45l-137 137q71 66 161 102t187 36q134 0 250-65t186-179q11-17 53-117 8-23 30-23h192q13 0 22.5 9.5t9.5 22.5zm25-800v448q0 26-19 45t-45 19h-448q-26 0-45-19t-19-45 19-45l138-138q-148-137-349-137-134 0-250 65t-186 179q-11 17-53 117-8 23-30 23h-199q-13 0-22.5-9.5t-9.5-22.5v-7q65-268 270-434.5t480-166.5q146 0 284 55.5t245 156.5l130-129q19-19 45-19t45 19 19 45z'/%3E%3C/svg%3E"), move`;
        // 24
        // return `url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABmJLR0QA/wD/AP+gvaeTAAABoElEQVRIidXVz0tVQRQH8E++iBK0hy2ENgYJpdCixVMCwUWrt2jjpvqL+hNaK1Skm/oD2iovQ8TQQolaJyLpRp79cDH3xbzpvrkXrEVfGJg755zvmXvm/OAf40JNvYu4jWv4ga/4VOzPhft4hWP8StY+FnE3sRnBAho54nG8LiEtWz/xDKNo4m1xPj+I/CY+1ySP10e8i77bhNjGGMMbTERnp8XfrBSOu5jEAzzGpULvVi4kPawkt9rCdEZ/EhsD/qidKs8kCtvCg+XQRKeug6VI+B1TFeQjGfI/HAzhMBIuV5ATUjH36LP0F9ocLhf7LaGYcmjgXmQT4xvWa1zyP0AcohauluicYE113xnHnWJ/JFT0b8zKP9hCjcsuR/ofUmE7Q95RXQ9TQmr3bJ7UddARiimHUexENl3c6AmHKoyHcT0jn8aq/qJ8ii+pYi5Ep3iOR0Lvb+Gh0Le6ie4mrpTdJHawjt2Mw0HrvZBJpZjXH/MmXgrDpA75ooq3agipmGZLS5hWByWkh3ih6DmDUHfoN4RJ1wvBPvb8haF/bpwBBca+xkfzCiAAAAAASUVORK5CYII=) 12 12, move`;

        // 16
        return `url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAv0lEQVQ4jc3SsWpCMRjF8d9QrU62HQQH30kqOBSuDyC0m+8l3EcQFEQpiJNdCl0dbVcdkuH2muCofwiEnJzDR3K4R9qY4hN/OGKJCZpooMiZ+9jhlFkblHF/QQvbKH7hFR10McJ3LeyCjyjs8VzTGphdC5hHYZDQxjXzIRVwew7+jzlO3BlErUwFVM0z4eGqvAi/c5LpQTXgB2/o4QnDinmBh1xAKTQwV6S10IskRRz7Ee9CfY/4xSqeNXPm23EGcGlDuo+t5h8AAAAASUVORK5CYII=) 8 8, move`;
      }
      if (intermediateHandlePicked) {
        return 'cell';
      }
    }

    return isDragging ? 'grabbing' : 'grab';
  }
}

EditableGeoJsonLayer.layerName = 'EditableGeoJsonLayer';
EditableGeoJsonLayer.defaultProps = defaultProps;