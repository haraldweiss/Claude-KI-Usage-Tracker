import React, { useState } from 'react';
import { updatePricing, confirmPricing } from '../services/api';
import { PricingTableProps } from '../types/components';

export default function PricingTable(props: PricingTableProps): React.ReactElement {
  const { pricing = [], onUpdate, readOnly = false } = props;
  const [editing, setEditing] = useState<Record<string, boolean | string>>({});
  const [saving, setSaving] = useState<boolean>(false);

  const handleEdit = (model: string): void => {
    setEditing((prev) => ({
      ...prev,
      [model]: !prev[model],
    }));
  };

  const handleChange = (model: string, field: string, value: string): void => {
    setEditing((prev) => ({
      ...prev,
      [`${model}_${field}`]: value,
    }));
  };

  const handleSave = async (model: string): Promise<void> => {
    try {
      setSaving(true);
      const inputPrice = parseFloat(editing[`${model}_input`] as string) || 
        pricing.find((p) => p.model === model)?.input_price || 0;
      const outputPrice = parseFloat(editing[`${model}_output`] as string) || 
        pricing.find((p) => p.model === model)?.output_price || 0;

      await updatePricing(model, inputPrice, outputPrice);
      setEditing((prev) => {
        const newEditing = { ...prev };
        delete newEditing[model];
        delete newEditing[`${model}_input`];
        delete newEditing[`${model}_output`];
        return newEditing;
      });
      if (onUpdate) {
        onUpdate();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert('Failed to update pricing: ' + errorMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Model
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Input Price ($/M)
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Output Price ($/M)
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Updated
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {pricing.map((item) => (
            <tr key={item.model} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.model}</td>
              <td className="px-6 py-4 text-sm">
                {editing[item.model] && !readOnly ? (
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={item.input_price}
                    onChange={(e) => handleChange(item.model, 'input', e.target.value)}
                    className="w-20 px-2 py-1 border rounded"
                  />
                ) : (
                  item.input_price.toFixed(2)
                )}
              </td>
              <td className="px-6 py-4 text-sm">
                {editing[item.model] && !readOnly ? (
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={item.output_price}
                    onChange={(e) => handleChange(item.model, 'output', e.target.value)}
                    className="w-20 px-2 py-1 border rounded"
                  />
                ) : (
                  item.output_price.toFixed(2)
                )}
              </td>
              <td className="px-6 py-4 text-sm text-gray-600">
                {new Date(item.last_updated).toLocaleDateString()}
              </td>
              <td className="px-4 py-2">
                <span
                  className={
                    'inline-block px-2 py-0.5 text-xs rounded-full ' +
                    (item.status === 'pending_confirmation'
                      ? 'bg-amber-100 text-amber-800'
                      : item.status === 'deprecated'
                        ? 'bg-gray-200 text-gray-600'
                        : item.source === 'manual'
                          ? 'bg-blue-100 text-blue-800'
                          : item.source === 'auto'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-slate-100 text-slate-700')
                  }
                >
                  {item.status === 'pending_confirmation'
                    ? 'Needs review'
                    : item.status === 'deprecated'
                      ? 'Deprecated'
                      : (item.source ?? 'unknown')}
                </span>
              </td>
              <td className="px-6 py-4 text-sm">
                {editing[item.model] ? (
                  <>
                    {!readOnly && (
                      <>
                        <button
                          onClick={() => handleSave(item.model)}
                          disabled={saving}
                          className="text-blue-600 hover:text-blue-900 mr-2 font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => handleEdit(item.model)}
                          className="text-gray-600 hover:text-gray-900 font-medium"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {item.status === 'pending_confirmation' && !readOnly && (
                      <button
                        onClick={async () => {
                          try {
                            await confirmPricing(item.model, item.input_price, item.output_price);
                            if (onUpdate) onUpdate();
                          } catch (err) {
                            alert('Confirm failed: ' + (err instanceof Error ? err.message : 'unknown error'));
                          }
                        }}
                        className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 mr-2"
                      >
                        Confirm
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        onClick={() => handleEdit(item.model)}
                        className="text-blue-600 hover:text-blue-900 font-medium"
                      >
                        Edit
                      </button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
