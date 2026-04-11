import { useState } from 'react';
import { updatePricing } from '../services/api';

export default function PricingTable({ pricing, onUpdate }) {
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState(false);

  const handleEdit = (model) => {
    setEditing(prev => ({
      ...prev,
      [model]: !prev[model]
    }));
  };

  const handleChange = (model, field, value) => {
    setEditing(prev => ({
      ...prev,
      [`${model}_${field}`]: value
    }));
  };

  const handleSave = async (model) => {
    try {
      setSaving(true);
      const inputPrice = parseFloat(editing[`${model}_input`]) || pricing.find(p => p.model === model)?.input_price;
      const outputPrice = parseFloat(editing[`${model}_output`]) || pricing.find(p => p.model === model)?.output_price;

      await updatePricing(model, inputPrice, outputPrice);
      setEditing(prev => {
        const newEditing = { ...prev };
        delete newEditing[model];
        delete newEditing[`${model}_input`];
        delete newEditing[`${model}_output`];
        return newEditing;
      });
      onUpdate();
    } catch (error) {
      alert('Failed to update pricing: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Model</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Input Price ($/M)</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Output Price ($/M)</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Updated</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {pricing.map((item) => (
            <tr key={item.model} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.model}</td>
              <td className="px-6 py-4 text-sm">
                {editing[item.model] ? (
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
                {editing[item.model] ? (
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
              <td className="px-6 py-4 text-sm">
                {editing[item.model] ? (
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
                ) : (
                  <button
                    onClick={() => handleEdit(item.model)}
                    className="text-blue-600 hover:text-blue-900 font-medium"
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
