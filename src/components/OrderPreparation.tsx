import React, { useState } from 'react';
import { type PreparationDraft } from '../utils/orderPreparation';
import { workflowDate } from '../utils/orderWorkflow';
import { OrderImageFields } from './OrderDeliveryFields';

export const PreparationFields: React.FC<{
  value: PreparationDraft; onChange: (value: PreparationDraft) => void; disabled?: boolean;
  onUpload: (file: File) => Promise<string>; onUploadingChange?: (uploading: boolean) => void; allowInPerson?: boolean;
}> = ({ value, onChange, disabled, onUpload, onUploadingChange, allowInPerson = false }) => {
  const [uploading, setUploading] = useState(false);
  const update = (patch: Partial<PreparationDraft>) => onChange({ ...value, ...patch });
  const field = 'flex flex-col gap-2 text-sm';
  return <section className="space-y-4">
    {!allowInPerson && <p className="text-sm">Al completar este paso la orden pasa automáticamente a Listo para Retiro o Listo para Despacho, según la modalidad. No registra cobros, recepción del core ni entrega física.</p>}
    <fieldset disabled={disabled || uploading} className="space-y-4">
      <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={value.yardNotified} onChange={event => update({ yardNotified: event.target.checked })} />{value.channel === 'in_person' ? 'Verifiqué en yarda que la pieza está lista para entregar.' : 'El patio notificó al call center que la pieza está lista.'}</label>
      <label className={field}>Tipo de comunicación con el cliente
        <select value={value.channel} onChange={event => {
          const channel = event.target.value as PreparationDraft['channel'];
          update({ channel, screenshots: [], failedCall: false, failedCallNotes: '', customerConfirmed: false,
            yardNotified: channel === 'in_person' || value.channel === 'in_person' ? false : value.yardNotified,
            ...(channel === 'in_person' ? { deliveryType: 'retiro_tienda', address: '', dateFrom: workflowDate(new Date()), dateTo: workflowDate(new Date()) } : {}) });
        }}>
          <option value="call">Llamada contestada</option><option value="sms">Mensaje de texto después de llamada sin respuesta</option>
          {(allowInPerson || value.channel === 'in_person') && <option value="in_person">Cliente presente · entrega inmediata en yarda</option>}
        </select>
      </label>
      {value.channel === 'sms' && <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={value.failedCall} onChange={event => update({ failedCall: event.target.checked })} />Intenté llamar y no logré contactar al cliente.</label>
        <label className={field}>Detalle del intento de llamada sin respuesta<textarea required minLength={5} maxLength={1000} value={value.failedCallNotes} onChange={event => update({ failedCallNotes: event.target.value })} /></label>
        <OrderImageFields photos={value.screenshots} onChange={screenshots => update({ screenshots })} onUpload={onUpload}
          label="Capturas de la conversación y respuesta del cliente (una o más)" description="Adjunta la conversación y la respuesta del cliente."
          imageLabel="Ver captura" removeLabel="Quitar captura" required disabled={disabled}
          onUploadingChange={active => { setUploading(active); onUploadingChange?.(active); }} />
      </div>}
      <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={value.customerConfirmed} onChange={event => update({ customerConfirmed: event.target.checked })} />El cliente confirmó que recibió la información de que su pieza está lista.</label>
      {value.channel === 'in_person' ? <p className="text-sm">El cliente está presente y recibe la pieza hoy en yarda. No se registra una llamada ni una cita futura.</p> : <>
      <label className={field}>Modalidad acordada
        <select value={value.deliveryType} onChange={event => update({ deliveryType: event.target.value as PreparationDraft['deliveryType'], address: '' })}>
          <option value="retiro_tienda">Recogida en yarda</option><option value="envio_domicilio">Delivery / envío</option>
        </select>
      </label>
      {value.deliveryType === 'envio_domicilio' && <label className={field}>Dirección de entrega
        <textarea required minLength={5} maxLength={500} value={value.address} onChange={event => update({ address: event.target.value })} />
      </label>}
      <p className="text-sm">Fecha acordada con el cliente: para un día exacto usa la misma fecha en ambos campos; para días tentativos indica el inicio y fin del rango.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>Fecha acordada desde<input required type="date" min={workflowDate(new Date())} value={value.dateFrom} onChange={event => update({ dateFrom: event.target.value })} /></label>
        <label className={field}>Fecha acordada hasta<input required type="date" min={value.dateFrom || workflowDate(new Date())} value={value.dateTo} onChange={event => update({ dateTo: event.target.value })} /></label>
      </div>
      </>}
      <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={value.balanceNotified} onChange={event => update({ balanceNotified: event.target.checked })} />Informé al cliente el monto del saldo restante.</label>
      <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={value.paymentMethodsNotified} onChange={event => update({ paymentMethodsNotified: event.target.checked })} />Informé que el saldo se paga únicamente en efectivo, Cash App o Zelle.</label>
      <label className={field}>Acuerdo del core
        <select required value={value.corePlan} onChange={event => update({ corePlan: event.target.value as PreparationDraft['corePlan'] })}>
          <option value="">Selecciona la respuesta del cliente</option><option value="return_core">El cliente llevará el core</option><option value="pay_core">El cliente pagará el core</option>
        </select>
      </label>
    </fieldset>
  </section>;
};
