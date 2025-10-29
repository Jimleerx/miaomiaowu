package handler

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// reorderProxyFields reorders proxy configuration to put key fields first
func reorderProxyFields(config map[string]any) *yaml.Node {
	// Priority fields that should appear first
	priorityFields := []string{"name", "type", "server", "port"}

	// Create a yaml.Node with mapping kind
	node := &yaml.Node{
		Kind: yaml.MappingNode,
	}

	// Add priority fields first
	for _, key := range priorityFields {
		if value, ok := config[key]; ok {
			// Add key node
			keyNode := &yaml.Node{
				Kind:  yaml.ScalarNode,
				Value: key,
			}
			node.Content = append(node.Content, keyNode)

			// Add value node
			valueNode := encodeValue(value)
			node.Content = append(node.Content, valueNode)
		}
	}

	// Add remaining fields
	for key, value := range config {
		// Skip priority fields (already added)
		isPriority := false
		for _, pf := range priorityFields {
			if key == pf {
				isPriority = true
				break
			}
		}
		if isPriority {
			continue
		}

		// Add key node
		keyNode := &yaml.Node{
			Kind:  yaml.ScalarNode,
			Value: key,
		}
		node.Content = append(node.Content, keyNode)

		// Add value node
		valueNode := encodeValue(value)
		node.Content = append(node.Content, valueNode)
	}

	return node
}

// encodeValue converts a Go value to a yaml.Node
func encodeValue(value any) *yaml.Node {
	node := &yaml.Node{}

	switch v := value.(type) {
	case string:
		node.Kind = yaml.ScalarNode
		node.Value = v
	case int:
		node.Kind = yaml.ScalarNode
		node.SetString(fmt.Sprintf("%d", v))
	case int64:
		node.Kind = yaml.ScalarNode
		node.SetString(fmt.Sprintf("%d", v))
	case float64:
		node.Kind = yaml.ScalarNode
		node.SetString(fmt.Sprintf("%v", v))
	case bool:
		node.Kind = yaml.ScalarNode
		if v {
			node.Value = "true"
		} else {
			node.Value = "false"
		}
	case []any:
		node.Kind = yaml.SequenceNode
		for _, item := range v {
			node.Content = append(node.Content, encodeValue(item))
		}
	case map[string]any:
		node.Kind = yaml.MappingNode
		for k, val := range v {
			keyNode := &yaml.Node{
				Kind:  yaml.ScalarNode,
				Value: k,
			}
			node.Content = append(node.Content, keyNode)
			node.Content = append(node.Content, encodeValue(val))
		}
	default:
		// Fallback: encode as string
		node.Kind = yaml.ScalarNode
		node.SetString(fmt.Sprintf("%v", v))
	}

	return node
}

// syncNodeToYAMLFiles updates node information in all YAML subscription files
func syncNodeToYAMLFiles(subscribeDir, oldNodeName, newNodeName string, clashConfigJSON string) error {
	if subscribeDir == "" {
		return fmt.Errorf("subscribe directory is empty")
	}

	// Parse the new clash config
	var newClashConfig map[string]any
	if err := json.Unmarshal([]byte(clashConfigJSON), &newClashConfig); err != nil {
		return fmt.Errorf("parse new clash config: %w", err)
	}

	// Get all YAML files in subscribes directory
	entries, err := os.ReadDir(subscribeDir)
	if err != nil {
		return fmt.Errorf("read subscribe directory: %w", err)
	}

	// Process each YAML file
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		// Skip non-YAML files and the .keep.yaml placeholder
		if filepath.Ext(filename) != ".yaml" && filepath.Ext(filename) != ".yml" {
			continue
		}
		if filename == ".keep.yaml" {
			continue
		}

		filePath := filepath.Join(subscribeDir, filename)

		// Read YAML file
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue // Skip files we can't read
		}

		// Parse YAML
		var yamlContent map[string]any
		if err := yaml.Unmarshal(data, &yamlContent); err != nil {
			continue // Skip invalid YAML files
		}

		// Check if file has proxies field
		proxies, ok := yamlContent["proxies"].([]any)
		if !ok || len(proxies) == 0 {
			continue
		}

		modified := false
		nameChanged := oldNodeName != newNodeName

		// Update or remove matching nodes
		newProxies := make([]any, 0, len(proxies))
		for _, proxy := range proxies {
			proxyMap, ok := proxy.(map[string]any)
			if !ok {
				newProxies = append(newProxies, proxy)
				continue
			}

			proxyName, ok := proxyMap["name"].(string)
			if !ok {
				newProxies = append(newProxies, proxy)
				continue
			}

			// If name matches old name
			if proxyName == oldNodeName {
				if nameChanged {
					// Name changed: replace with new config at current position
					newProxies = append(newProxies, newClashConfig)
					modified = true
				} else {
					// Name unchanged: update node config in place
					for key, value := range newClashConfig {
						proxyMap[key] = value
					}
					newProxies = append(newProxies, proxyMap)
					modified = true
				}
			} else {
				newProxies = append(newProxies, proxyMap)
			}
		}

		// If nothing changed, skip this file
		if !modified {
			continue
		}

		// Update proxies in YAML content with ordered fields
		orderedProxiesForMap := make([]any, 0, len(newProxies))
		for _, proxy := range newProxies {
			orderedProxiesForMap = append(orderedProxiesForMap, proxy)
		}
		yamlContent["proxies"] = orderedProxiesForMap

		// Also update proxy-groups if they reference the old name
		if proxyGroups, ok := yamlContent["proxy-groups"].([]any); ok {
			for _, group := range proxyGroups {
				groupMap, ok := group.(map[string]any)
				if !ok {
					continue
				}

				// Update proxies list in group
				if groupProxies, ok := groupMap["proxies"].([]any); ok {
					updatedGroupProxies := make([]any, 0, len(groupProxies))
					for _, groupProxy := range groupProxies {
						proxyName, ok := groupProxy.(string)
						if !ok {
							updatedGroupProxies = append(updatedGroupProxies, groupProxy)
							continue
						}

						if proxyName == oldNodeName && nameChanged {
							// Replace old name with new name
							updatedGroupProxies = append(updatedGroupProxies, newNodeName)
						} else {
							updatedGroupProxies = append(updatedGroupProxies, groupProxy)
						}
					}
					groupMap["proxies"] = updatedGroupProxies
				}
			}
		}

		// Also update rules if they reference the old name
		if rules, ok := yamlContent["rules"].([]any); ok {
			updatedRules := make([]any, 0, len(rules))
			for _, rule := range rules {
				ruleStr, ok := rule.(string)
				if !ok {
					updatedRules = append(updatedRules, rule)
					continue
				}

				// Check if rule references the old node name
				if nameChanged && containsNodeName(ruleStr, oldNodeName) {
					// Replace old name with new name in rule
					updatedRules = append(updatedRules, replaceNodeNameInRule(ruleStr, oldNodeName, newNodeName))
				} else {
					updatedRules = append(updatedRules, rule)
				}
			}
			yamlContent["rules"] = updatedRules
		}

		// Re-read the file as yaml.Node to preserve structure
		var rootNode yaml.Node
		fileContent, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}
		if err := yaml.Unmarshal(fileContent, &rootNode); err != nil {
			continue
		}

		// Find and update the proxies section with ordered fields
		if rootNode.Kind == yaml.DocumentNode && len(rootNode.Content) > 0 {
			docNode := rootNode.Content[0]
			if docNode.Kind == yaml.MappingNode {
				// Find the proxies key
				for i := 0; i < len(docNode.Content); i += 2 {
					if i+1 >= len(docNode.Content) {
						break
					}
					keyNode := docNode.Content[i]
					if keyNode.Value == "proxies" {
						// Replace the proxies sequence with ordered version
						orderedProxiesSeq := &yaml.Node{
							Kind: yaml.SequenceNode,
						}
						for _, proxy := range newProxies {
							if proxyMap, ok := proxy.(map[string]any); ok {
								orderedProxiesSeq.Content = append(orderedProxiesSeq.Content, reorderProxyFields(proxyMap))
							}
						}
						docNode.Content[i+1] = orderedProxiesSeq
						break
					}
				}

				// Update proxy-groups if name changed
				if nameChanged {
					for i := 0; i < len(docNode.Content); i += 2 {
						if i+1 >= len(docNode.Content) {
							break
						}
						keyNode := docNode.Content[i]
						if keyNode.Value == "proxy-groups" {
							updateProxyGroupsNode(docNode.Content[i+1], oldNodeName, newNodeName)
							break
						}
					}

					// Update rules if name changed
					for i := 0; i < len(docNode.Content); i += 2 {
						if i+1 >= len(docNode.Content) {
							break
						}
						keyNode := docNode.Content[i]
						if keyNode.Value == "rules" {
							updateRulesNode(docNode.Content[i+1], oldNodeName, newNodeName)
							break
						}
					}
				}

				// Reorder top-level fields to put dns, proxies, proxy-groups before rule-providers
				reorderTopLevelFields(docNode)
			}
		}

		// Encode to YAML using yaml.Marshal on the node
		output, err := yaml.Marshal(&rootNode)
		if err != nil {
			continue // Skip files we can't marshal
		}

		if err := os.WriteFile(filePath, output, 0644); err != nil {
			continue // Skip files we can't write
		}
	}

	return nil
}

// updateProxyGroupsNode updates proxy-groups node to replace old node name with new name
func updateProxyGroupsNode(groupsNode *yaml.Node, oldName, newName string) {
	if groupsNode.Kind != yaml.SequenceNode {
		return
	}

	for _, groupNode := range groupsNode.Content {
		if groupNode.Kind != yaml.MappingNode {
			continue
		}

		// Find the "proxies" key in this group
		for i := 0; i < len(groupNode.Content); i += 2 {
			if i+1 >= len(groupNode.Content) {
				break
			}
			keyNode := groupNode.Content[i]
			if keyNode.Value == "proxies" {
				valueNode := groupNode.Content[i+1]
				if valueNode.Kind == yaml.SequenceNode {
					// Update proxy names in the sequence
					for _, proxyNode := range valueNode.Content {
						if proxyNode.Kind == yaml.ScalarNode && proxyNode.Value == oldName {
							proxyNode.Value = newName
						}
					}
				}
				break
			}
		}
	}
}

// updateRulesNode updates rules node to replace old node name with new name
func updateRulesNode(rulesNode *yaml.Node, oldName, newName string) {
	if rulesNode.Kind != yaml.SequenceNode {
		return
	}

	for _, ruleNode := range rulesNode.Content {
		if ruleNode.Kind == yaml.ScalarNode {
			if containsNodeName(ruleNode.Value, oldName) {
				ruleNode.Value = replaceNodeNameInRule(ruleNode.Value, oldName, newName)
			}
		}
	}
}

// containsNodeName checks if a rule string references a node name
func containsNodeName(rule, nodeName string) bool {
	// Rules format: TYPE,PARAM,NODE_NAME
	// Example: DOMAIN-SUFFIX,google.com,节点名称
	parts := splitRule(rule)
	if len(parts) >= 3 {
		return parts[len(parts)-1] == nodeName
	}
	return false
}

// replaceNodeNameInRule replaces node name in a rule string
func replaceNodeNameInRule(rule, oldName, newName string) string {
	parts := splitRule(rule)
	if len(parts) >= 3 && parts[len(parts)-1] == oldName {
		parts[len(parts)-1] = newName
		result := ""
		for i, part := range parts {
			if i > 0 {
				result += ","
			}
			result += part
		}
		return result
	}
	return rule
}

// splitRule splits a rule string by comma, handling escaped commas
func splitRule(rule string) []string {
	var parts []string
	var current string
	escaped := false

	for _, ch := range rule {
		if escaped {
			current += string(ch)
			escaped = false
			continue
		}

		if ch == '\\' {
			escaped = true
			continue
		}

		if ch == ',' {
			parts = append(parts, current)
			current = ""
			continue
		}

		current += string(ch)
	}

	if current != "" {
		parts = append(parts, current)
	}

	return parts
}

// reorderTopLevelFields reorders the top-level YAML fields to put important sections first
func reorderTopLevelFields(docNode *yaml.Node) {
	if docNode.Kind != yaml.MappingNode {
		return
	}

	// Define field pair structure
	type fieldPair struct {
		key   *yaml.Node
		value *yaml.Node
	}

	// yaml属性指定排序
	priorityFields := []string{
		"port",
		"socks-port",
		"allow-lan",
		"mode",
		"log-level",
		"geodata-mode",
		"geo-auto-update",
		"geodata-loader",
		"geo-update-interval",
		"geox-url",
		"dns",
		"proxies",
		"proxy-groups",
		"rule-providers",
		"rules",
	}

	// Create a map to store all key-value pairs
	fieldMap := make(map[string]*fieldPair)
	var otherFields []*fieldPair

	// Extract all fields
	for i := 0; i < len(docNode.Content); i += 2 {
		if i+1 >= len(docNode.Content) {
			break
		}
		keyNode := docNode.Content[i]
		valueNode := docNode.Content[i+1]

		pair := &fieldPair{key: keyNode, value: valueNode}

		// Check if this is a priority field
		isPriority := false
		for _, pf := range priorityFields {
			if keyNode.Value == pf {
				fieldMap[pf] = pair
				isPriority = true
				break
			}
		}

		if !isPriority {
			otherFields = append(otherFields, pair)
		}
	}

	// Rebuild Content with priority fields first
	newContent := make([]*yaml.Node, 0, len(docNode.Content))

	// Add priority fields in order
	for _, fieldName := range priorityFields {
		if pair, ok := fieldMap[fieldName]; ok {
			newContent = append(newContent, pair.key, pair.value)
		}
	}

	// Add remaining fields in their original order
	for _, pair := range otherFields {
		newContent = append(newContent, pair.key, pair.value)
	}

	// Replace the content
	docNode.Content = newContent
}
